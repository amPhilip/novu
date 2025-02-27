import {
  LogRepository,
  MessageRepository,
  NotificationRepository,
  NotificationTemplateEntity,
  SubscriberEntity,
} from '@novu/dal';
import { ISubscribersDefine, ITopic, TriggerRecipients } from '@novu/node';
import {
  ChannelTypeEnum,
  StepTypeEnum,
  IEmailBlock,
  TopicId,
  TopicKey,
  TopicName,
  TriggerRecipientsTypeEnum,
  ExternalSubscriberId,
} from '@novu/shared';
import { SubscribersService, UserSession } from '@novu/testing';
import axios from 'axios';
import { expect } from 'chai';

import { TriggerEventRequestDto } from '../dtos';

const axiosInstance = axios.create();

const TOPIC_PATH = '/v1/topics';
const TRIGGER_ENDPOINT = '/v1/events/trigger';

describe('Topic Trigger Event', () => {
  describe('Trigger event for a topic - /v1/events/trigger (POST)', () => {
    let session: UserSession;
    let template: NotificationTemplateEntity;
    let firstSubscriber: SubscriberEntity;
    let secondSubscriber: SubscriberEntity;
    let subscribers: SubscriberEntity[];
    let subscriberService: SubscribersService;
    let createdTopicDto: { _id: TopicId; key: TopicKey };
    let to: TriggerRecipients;
    let triggerEndpointUrl: string;
    const notificationRepository = new NotificationRepository();
    const messageRepository = new MessageRepository();
    const logRepository = new LogRepository();

    beforeEach(async () => {
      process.env.FF_IS_TOPIC_NOTIFICATION_ENABLED = 'true';
      session = new UserSession();
      await session.initialize();

      triggerEndpointUrl = `${session.serverUrl}${TRIGGER_ENDPOINT}`;

      template = await session.createTemplate();
      subscriberService = new SubscribersService(session.organization._id, session.environment._id);
      firstSubscriber = await subscriberService.createSubscriber();
      secondSubscriber = await subscriberService.createSubscriber();
      subscribers = [firstSubscriber, secondSubscriber];

      const topicKey = 'topic-key-trigger-event';
      const topicName = 'topic-name-trigger-event';
      createdTopicDto = await createTopic(session, topicKey, topicName);
      await addSubscribersToTopic(session, createdTopicDto, subscribers);
      to = [{ type: TriggerRecipientsTypeEnum.TOPIC, topicKey: createdTopicDto.key }];
    });

    afterEach(() => {
      process.env.FF_IS_TOPIC_NOTIFICATION_ENABLED = 'false';
    });

    it('should generate logs for the notification for a topic with 2 subscribers', async () => {
      await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);

      const logs = await logRepository.find({
        _environmentId: session.environment._id,
        _organizationId: session.organization._id,
      });

      expect(logs.length).to.be.eql(5);
      expect(logs.find((log) => log.text === 'Request processed' && log._subscriberId === firstSubscriber._id)).to
        .exist;
      expect(logs.find((log) => log.text === 'Request processed' && log._subscriberId === secondSubscriber._id)).to
        .exist;
      expect(logs.find((log) => log.text === 'In App message created' && log._subscriberId === firstSubscriber._id)).to
        .exist;
      expect(logs.find((log) => log.text === 'In App message created' && log._subscriberId === secondSubscriber._id)).to
        .exist;
    });

    it('should trigger an event successfully', async () => {
      const response = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      const { data: body } = response;

      expect(body.data).to.be.ok;
      expect(body.data.status).to.equal('processed');
      expect(body.data.acknowledged).to.equal(true);
      expect(body.data.transactionId).to.exist;
    });

    it('should generate message and notification based on event', async () => {
      const attachments = [
        {
          name: 'text1.txt',
          file: 'hello world!',
        },
        {
          name: 'text2.txt',
          file: Buffer.from('hello world!', 'utf-8'),
        },
      ];

      const { data: body } = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to, attachments),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);

      expect(subscribers.length).to.be.greaterThan(0);

      for (const subscriber of subscribers) {
        const notifications = await notificationRepository.findBySubscriberId(session.environment._id, subscriber._id);

        expect(notifications.length).to.equal(1);

        const notification = notifications[0];

        expect(notification._organizationId).to.equal(session.organization._id);
        expect(notification._templateId).to.equal(template._id);

        const messages = await messageRepository.findBySubscriberChannel(
          session.environment._id,
          subscriber._id,
          ChannelTypeEnum.IN_APP
        );

        expect(messages.length).to.equal(1);
        const message = messages[0];

        expect(message.channel).to.equal(ChannelTypeEnum.IN_APP);
        expect(message.content as string).to.equal('Test content for <b>Testing of User Name</b>');
        expect(message.seen).to.equal(false);
        expect(message.cta.data.url).to.equal('/cypress/test-shell/example/test?test-param=true');
        expect(message.lastSeenDate).to.be.not.ok;
        expect(message.payload.firstName).to.equal('Testing of User Name');
        expect(message.payload.urlVariable).to.equal('/test/url/path');
        expect(message.payload.attachments).to.be.not.ok;

        const emails = await messageRepository.findBySubscriberChannel(
          session.environment._id,
          subscriber._id,
          ChannelTypeEnum.EMAIL
        );

        expect(emails.length).to.equal(1);
        const email = emails[0];

        expect(email.channel).to.equal(ChannelTypeEnum.EMAIL);
        expect(Array.isArray(email.content)).to.be.ok;
        expect((email.content[0] as IEmailBlock).type).to.equal('text');
        expect((email.content[0] as IEmailBlock).content).to.equal(
          'This are the text contents of the template for Testing of User Name'
        );
      }
    });

    it('should trigger SMS notification', async () => {
      template = await session.createTemplate({
        steps: [
          {
            type: StepTypeEnum.SMS,
            content: 'Hello world {{customVar}}' as string,
          },
        ],
      });

      const { data: body } = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);

      expect(subscribers.length).to.be.greaterThan(0);

      for (const subscriber of subscribers) {
        const message = await messageRepository._model.findOne({
          _environmentId: session.environment._id,
          _templateId: template._id,
          _subscriberId: subscriber._id,
          channel: ChannelTypeEnum.SMS,
        });

        expect(message._subscriberId.toString()).to.be.eql(subscriber._id);
        expect(message.phone).to.equal(subscriber.phone);
      }
    });
  });

  describe('Trigger event for multiple topics and multiple subscribers - /v1/events/trigger (POST)', () => {
    let session: UserSession;
    let template: NotificationTemplateEntity;
    let firstSubscriber: SubscriberEntity;
    let secondSubscriber: SubscriberEntity;
    let thirdSubscriber: SubscriberEntity;
    let fourthSubscriber: SubscriberEntity;
    let fifthSubscriber: SubscriberEntity;
    let sixthSubscriber: SubscriberEntity;
    let subscribers: SubscriberEntity[];
    let subscriberService: SubscribersService;
    let firstTopicDto: { _id: TopicId; key: TopicKey };
    let secondTopicDto: { _id: TopicId; key: TopicKey };
    let triggerEndpointUrl: string;
    let to: TriggerRecipients;
    const notificationRepository = new NotificationRepository();
    const messageRepository = new MessageRepository();
    const logRepository = new LogRepository();

    beforeEach(async () => {
      process.env.FF_IS_TOPIC_NOTIFICATION_ENABLED = 'true';
      session = new UserSession();
      await session.initialize();

      triggerEndpointUrl = `${session.serverUrl}${TRIGGER_ENDPOINT}`;

      template = await session.createTemplate();
      subscriberService = new SubscribersService(session.organization._id, session.environment._id);
      firstSubscriber = await subscriberService.createSubscriber();
      secondSubscriber = await subscriberService.createSubscriber();
      const firstTopicSubscribers = [firstSubscriber, secondSubscriber];

      const firstTopicKey = 'topic-key-1-trigger-event';
      const firstTopicName = 'topic-name-1-trigger-event';
      firstTopicDto = await createTopic(session, firstTopicKey, firstTopicName);

      await addSubscribersToTopic(session, firstTopicDto, firstTopicSubscribers);

      thirdSubscriber = await subscriberService.createSubscriber();
      fourthSubscriber = await subscriberService.createSubscriber();
      const secondTopicSubscribers = [thirdSubscriber, fourthSubscriber];

      const secondTopicKey = 'topic-key-2-trigger-event';
      const secondTopicName = 'topic-name-2-trigger-event';
      secondTopicDto = await createTopic(session, secondTopicKey, secondTopicName);

      await addSubscribersToTopic(session, secondTopicDto, secondTopicSubscribers);

      fifthSubscriber = await subscriberService.createSubscriber();
      sixthSubscriber = await subscriberService.createSubscriber();

      subscribers = [
        firstSubscriber,
        secondSubscriber,
        thirdSubscriber,
        fourthSubscriber,
        fifthSubscriber,
        sixthSubscriber,
      ];
      to = [
        { type: TriggerRecipientsTypeEnum.TOPIC, topicKey: firstTopicDto.key },
        { type: TriggerRecipientsTypeEnum.TOPIC, topicKey: secondTopicDto.key },
        fifthSubscriber.subscriberId,
        {
          subscriberId: sixthSubscriber.subscriberId,
          firstName: 'Subscribers',
          lastName: 'Define',
          email: 'subscribers-define@email.novu',
        },
      ];
    });

    afterEach(() => {
      process.env.FF_IS_TOPIC_NOTIFICATION_ENABLED = 'false';
    });

    it('should generate logs for the notification for 2 topics with 2 subscribers and 2 individual subscribers', async () => {
      await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);

      const logs = await logRepository.find({
        _environmentId: session.environment._id,
        _organizationId: session.organization._id,
      });

      expect(logs.length).to.be.eql(13);
      expect(subscribers.length).to.be.greaterThan(0);
      for (const subscriber of subscribers) {
        expect(logs.find((log) => log.text === 'Request processed' && log._subscriberId === subscriber._id)).to.exist;
        expect(logs.find((log) => log.text === 'Request processed' && log._subscriberId === subscriber._id)).to.exist;
      }
    });

    it('should trigger an event successfully', async () => {
      const response = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      const { data: body } = response;

      expect(body.data).to.be.ok;
      expect(body.data.status).to.equal('processed');
      expect(body.data.acknowledged).to.equal(true);
      expect(body.data.transactionId).to.exist;
    });

    it('should generate message and notification based on event', async () => {
      const attachments = [
        {
          name: 'text1.txt',
          file: 'hello world!',
        },
        {
          name: 'text2.txt',
          file: Buffer.from('hello world!', 'utf-8'),
        },
      ];

      const { data: body } = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to, attachments),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);
      expect(subscribers.length).to.be.greaterThan(0);

      for (const subscriber of subscribers) {
        const notifications = await notificationRepository.findBySubscriberId(session.environment._id, subscriber._id);

        expect(notifications.length).to.equal(1);

        const notification = notifications[0];

        expect(notification._organizationId).to.equal(session.organization._id);
        expect(notification._templateId).to.equal(template._id);

        const messages = await messageRepository.findBySubscriberChannel(
          session.environment._id,
          subscriber._id,
          ChannelTypeEnum.IN_APP
        );

        expect(messages.length).to.equal(1);
        const message = messages[0];

        expect(message.channel).to.equal(ChannelTypeEnum.IN_APP);
        expect(message.content as string).to.equal('Test content for <b>Testing of User Name</b>');
        expect(message.seen).to.equal(false);
        expect(message.cta.data.url).to.equal('/cypress/test-shell/example/test?test-param=true');
        expect(message.lastSeenDate).to.be.not.ok;
        expect(message.payload.firstName).to.equal('Testing of User Name');
        expect(message.payload.urlVariable).to.equal('/test/url/path');
        expect(message.payload.attachments).to.be.not.ok;

        const emails = await messageRepository.findBySubscriberChannel(
          session.environment._id,
          subscriber._id,
          ChannelTypeEnum.EMAIL
        );

        expect(emails.length).to.equal(1);
        const email = emails[0];

        expect(email.channel).to.equal(ChannelTypeEnum.EMAIL);
        expect(Array.isArray(email.content)).to.be.ok;
        expect((email.content[0] as IEmailBlock).type).to.equal('text');
        expect((email.content[0] as IEmailBlock).content).to.equal(
          'This are the text contents of the template for Testing of User Name'
        );
      }
    });

    it('should trigger SMS notification', async () => {
      template = await session.createTemplate({
        steps: [
          {
            type: StepTypeEnum.SMS,
            content: 'Hello world {{customVar}}' as string,
          },
        ],
      });

      const { data: body } = await axiosInstance.post(
        triggerEndpointUrl,
        buildTriggerRequestPayload(template, to),
        buildTriggerRequestHeaders(session)
      );

      await session.awaitRunningJobs(template._id);

      expect(subscribers.length).to.be.greaterThan(0);

      for (const subscriber of subscribers) {
        const message = await messageRepository._model.findOne({
          _environmentId: session.environment._id,
          _templateId: template._id,
          _subscriberId: subscriber._id,
          channel: ChannelTypeEnum.SMS,
        });

        expect(message._subscriberId.toString()).to.be.eql(subscriber._id);
        expect(message.phone).to.equal(subscriber.phone);
      }
    });
  });
});

const createTopic = async (
  session: UserSession,
  key: TopicKey,
  name: TopicName
): Promise<{ _id: TopicId; key: TopicKey }> => {
  const response = await axiosInstance.post(
    `${session.serverUrl}${TOPIC_PATH}`,
    {
      key,
      name,
    },
    {
      headers: {
        authorization: `ApiKey ${session.apiKey}`,
      },
    }
  );

  expect(response.status).to.eql(201);
  const body = response.data;
  expect(body.data._id).to.exist;
  expect(body.data.key).to.eql(key);

  return body.data;
};

const addSubscribersToTopic = async (
  session: UserSession,
  createdTopicDto: { _id: TopicId; key: TopicKey },
  subscribers: SubscriberEntity[]
) => {
  const subscriberIds: ExternalSubscriberId[] = subscribers.map(
    (subscriber: SubscriberEntity) => subscriber.subscriberId
  );

  const response = await axiosInstance.post(
    `${session.serverUrl}${TOPIC_PATH}/${createdTopicDto.key}/subscribers`,
    {
      subscribers: subscriberIds,
    },
    {
      headers: {
        authorization: `ApiKey ${session.apiKey}`,
      },
    }
  );

  expect(response.status).to.be.eq(200);
  expect(response.data.data).to.be.eql({
    succeeded: subscriberIds,
  });
};

const buildTriggerRequestPayload = (
  template: NotificationTemplateEntity,
  to: (string | ITopic | ISubscribersDefine)[],
  attachments?: Record<string, unknown>[]
): TriggerEventRequestDto => {
  const payload = {
    name: template.triggers[0].identifier,
    to,
    payload: {
      firstName: 'Testing of User Name',
      urlVariable: '/test/url/path',
      ...(attachments && { attachments }),
    },
  };

  return payload;
};

const buildTriggerRequestHeaders = (session: UserSession) => ({
  headers: {
    authorization: `ApiKey ${session.apiKey}`,
  },
});
