export const COLUMNS_CACHE = {};

export function clearColumnsCache(tableNames = null, cacheKey = null) {
  if (!tableNames) {
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
    console.log('[dbProxy] Cleared entire columns cache');
    return;
  }

  for (const key in COLUMNS_CACHE) {
    const matchesTable = tableNames.some((tableName) => key.endsWith(`:${tableName}`));
    const matchesCacheKey = !cacheKey || key.startsWith(`${cacheKey}:`);
    if (matchesTable && matchesCacheKey) {
      delete COLUMNS_CACHE[key];
      console.log(`[dbProxy] Cleared cache for: ${key}`);
    }
  }
}

export async function hasTable(dbPool, tableName) {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return Number(rows[0]?.cnt || 0) > 0;
}

export async function hasColumn(dbPool, tableName, columnName) {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return Number(rows[0]?.cnt || 0) > 0;
}

export async function addColumnIfMissing(dbPool, tableName, columnName, definition) {
  if (await hasColumn(dbPool, tableName, columnName)) {
    return false;
  }

  await dbPool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  return true;
}

export async function ensureColumns(dbPool, tableName, columnDefinitions) {
  let changed = false;

  for (const [columnName, definition] of columnDefinitions) {
    const added = await addColumnIfMissing(dbPool, tableName, columnName, definition);
    changed = changed || added;
  }

  return changed;
}
