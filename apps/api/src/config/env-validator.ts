import { bool, makeValidator, port, str, url, ValidatorSpec } from 'envalid';
import * as envalid from 'envalid';

const str32 = makeValidator((variable) => {
  if (!(typeof variable === 'string') || variable.length != 32) {
    throw new Error('Expected to be string 32 char long');
  }

  return variable;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validators: { [K in keyof any]: ValidatorSpec<any[K]> } = {
  NODE_ENV: str({
    choices: ['dev', 'test', 'prod', 'ci', 'local'],
    default: 'local',
  }),
  PORT: port(),
  FRONT_BASE_URL: url(),
  DISABLE_USER_REGISTRATION: str({
    default: 'false',
    choices: ['false', 'true'],
  }),
  REDIS_HOST: str(),
  REDIS_PORT: port(),
  JWT_SECRET: str(),
  SENDGRID_API_KEY: str({
    default: '',
  }),
  MONGO_URL: str(),
  NOVU_API_KEY: str({
    default: '',
  }),
  STORE_ENCRYPTION_KEY: str32(),
  NEW_RELIC_APP_NAME: str({
    default: '',
  }),
  NEW_RELIC_LICENSE_KEY: str({
    default: '',
  }),
  FF_IS_TOPIC_NOTIFICATION_ENABLED: bool({
    desc: 'This is the environment variables used to enable the feature to send notifications to a topic',
    default: true,
    choices: [false, true],
  }),
  REDIS_CACHE_HOST: str({
    default: '',
  }),
  REDIS_CACHE_PORT: str({
    default: '',
  }),
  STORE_NOTIFICATION_CONTENT: str({
    default: 'false',
  }),
};

if (process.env.STORAGE_SERVICE === 'AZURE') {
  validators.AZURE_ACCOUNT_NAME = str();
  validators.AZURE_ACCOUNT_KEY = str();
  validators.AZURE_HOST_NAME = str({
    default: `https://${process.env.AZURE_ACCOUNT_NAME}.blob.core.windows.net`,
  });
  validators.AZURE_CONTAINER_NAME = str({
    default: 'novu',
  });
}

if (process.env.STORAGE_SERVICE === 'GCS') {
  validators.GCS_BUCKET_NAME = str();
  validators.GCS_DOMAIN = str();
}

if (process.env.STORAGE_SERVICE === 'AWS' || !process.env.STORAGE_SERVICE) {
  validators.S3_LOCAL_STACK = str({
    default: '',
  });
  validators.S3_BUCKET_NAME = str();
  validators.S3_REGION = str();
  validators.AWS_ACCESS_KEY_ID = str();
  validators.AWS_SECRET_ACCESS_KEY = str();
}

if (process.env.NODE_ENV !== 'local' && process.env.NODE_ENV !== 'test') {
  validators.SENTRY_DSN = str({
    default: '',
  });
  validators.VERCEL_CLIENT_ID = str({
    default: '',
  });
  validators.VERCEL_CLIENT_SECRET = str({
    default: '',
  });
  validators.VERCEL_REDIRECT_URI = url({
    default: 'https://web.novu.co/auth/login',
  });
  validators.VERCEL_BASE_URL = url({
    default: 'https://api.vercel.com',
  });
}

export function validateEnv() {
  envalid.cleanEnv(process.env, validators);
}
