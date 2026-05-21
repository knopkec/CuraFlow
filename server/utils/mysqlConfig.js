const TCP_DSN_PATTERN = /^(?<user>[^:@/?#]+)(?::(?<password>[^@/?#]*))?@tcp\((?<host>[^)]+)\)\/(?<database>[^?]+)(?:\?(?<query>.*))?$/;
const DEFAULT_PORT = 3306;

function decodePart(value) {
  if (value === undefined || value === null) {
    return '';
  }

  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function normalizePort(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_PORT), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function splitHostAndPort(rawHost) {
  if (!rawHost) {
    return { host: '', port: DEFAULT_PORT };
  }

  const value = String(rawHost).trim();
  const bracketMatch = value.match(/^\[(.+)\](?::(\d+))?$/);
  if (bracketMatch) {
    return {
      host: bracketMatch[1],
      port: normalizePort(bracketMatch[2]),
    };
  }

  const lastColonIndex = value.lastIndexOf(':');
  if (lastColonIndex > -1 && value.indexOf(':') === lastColonIndex) {
    return {
      host: value.slice(0, lastColonIndex),
      port: normalizePort(value.slice(lastColonIndex + 1)),
    };
  }

  return { host: value, port: DEFAULT_PORT };
}

export function parseMysqlConnectionString(connectionString, label = 'MYSQL_URL') {
  const trimmed = String(connectionString || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is empty`);
  }

  if (/^mysql:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const database = parsed.pathname.replace(/^\/+/, '');
    if (!parsed.hostname || !parsed.username || !database) {
      throw new Error(`${label} must include host, user, and database`);
    }

    return {
      host: decodePart(parsed.hostname),
      port: normalizePort(parsed.port),
      user: decodePart(parsed.username),
      password: decodePart(parsed.password),
      database: decodePart(database),
      source: label,
    };
  }

  const tcpMatch = trimmed.match(TCP_DSN_PATTERN);
  if (tcpMatch?.groups) {
    const { host: hostPart, port } = splitHostAndPort(tcpMatch.groups.host);
    if (!hostPart || !tcpMatch.groups.user || !tcpMatch.groups.database) {
      throw new Error(`${label} must include host, user, and database`);
    }

    return {
      host: decodePart(hostPart),
      port,
      user: decodePart(tcpMatch.groups.user),
      password: decodePart(tcpMatch.groups.password),
      database: decodePart(tcpMatch.groups.database),
      source: label,
    };
  }

  throw new Error(`${label} uses an unsupported MySQL connection string format`);
}

function resolveFromDiscreteEnv(env, {
  hostEnvName,
  portEnvName,
  userEnvName,
  passwordEnvName,
  databaseEnvNames,
}) {
  const host = env[hostEnvName]?.trim();
  const user = env[userEnvName]?.trim();
  const password = env[passwordEnvName] ?? '';
  const database = databaseEnvNames
    .map((name) => env[name]?.trim())
    .find(Boolean);

  const hasAnyValue = [host, user, password, database].some((value) => value !== undefined && value !== null && value !== '');
  if (!hasAnyValue) {
    return null;
  }

  if (!host || !user || !database) {
    throw new Error(`Incomplete MySQL configuration in ${hostEnvName}/${userEnvName}/${databaseEnvNames.join(', ')}`);
  }

  return {
    host,
    port: normalizePort(env[portEnvName]),
    user,
    password,
    database,
    source: `${hostEnvName}/${userEnvName}/${databaseEnvNames[0]}`,
  };
}

function resolveMysqlConfig(env, options) {
  const {
    urlEnvNames,
    discrete,
    required = false,
  } = options;

  for (const envName of urlEnvNames) {
    if (env[envName]?.trim()) {
      return parseMysqlConnectionString(env[envName], envName);
    }
  }

  const discreteConfig = resolveFromDiscreteEnv(env, discrete);
  if (discreteConfig) {
    return discreteConfig;
  }

  if (required) {
    throw new Error(`Missing MySQL configuration. Checked ${urlEnvNames.join(', ')} and ${discrete.hostEnvName}/${discrete.userEnvName}/${discrete.databaseEnvNames.join(', ')}`);
  }

  return null;
}

export function resolveMasterDbConfig(env = process.env) {
  return resolveMysqlConfig(env, {
    urlEnvNames: ['CURAFLOW_MASTER_MYSQL_URL', 'MYSQL_URL'],
    discrete: {
      hostEnvName: 'MYSQL_HOST',
      portEnvName: 'MYSQL_PORT',
      userEnvName: 'MYSQL_USER',
      passwordEnvName: 'MYSQL_PASSWORD',
      databaseEnvNames: ['MYSQL_DATABASE'],
    },
    required: true,
  });
}

export function resolveTenantDbConfig(env = process.env, masterConfig = null) {
  const hasDedicatedTenantConnection = [
    'CURAFLOW_TENANT_MYSQL_URL',
    'TEST_TENANT_MYSQL_HOST',
    'TEST_TENANT_MYSQL_USER',
    'TEST_TENANT_MYSQL_PASSWORD',
    'TEST_TENANT_MYSQL_DATABASE',
  ].some((name) => env[name]?.trim());

  const directConfig = hasDedicatedTenantConnection
    ? resolveMysqlConfig(env, {
      urlEnvNames: ['CURAFLOW_TENANT_MYSQL_URL'],
      discrete: {
        hostEnvName: 'TEST_TENANT_MYSQL_HOST',
        portEnvName: 'TEST_TENANT_MYSQL_PORT',
        userEnvName: 'TEST_TENANT_MYSQL_USER',
        passwordEnvName: 'TEST_TENANT_MYSQL_PASSWORD',
        databaseEnvNames: ['TEST_TENANT_MYSQL_DATABASE', 'CURAFLOW_TENANT_DATABASE', 'TEST_TENANT_DATABASE'],
      },
      required: false,
    })
    : null;

  if (directConfig) {
    return directConfig;
  }

  const tenantDatabase = ['CURAFLOW_TENANT_DATABASE', 'TEST_TENANT_DATABASE']
    .map((name) => env[name]?.trim())
    .find(Boolean);

  if (tenantDatabase && masterConfig) {
    return {
      ...masterConfig,
      database: tenantDatabase,
      source: `${masterConfig.source}+${tenantDatabase}`,
    };
  }

  return null;
}
