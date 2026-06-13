#!/usr/bin/env node
/**
 * Read-only scan for Firestore changelog/export data in BigQuery.
 *
 * Looks for tables with document_id/user_id/raw_data-style schemas and runs
 * read-only aggregate/sample queries for the requested UID.
 */

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'style-genie-f65ef';

function parseArgs(argv) {
  const args = {
    uid: '',
    out: '',
    sampleLimit: 50,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--out') {
      args.out = argv[++i] || '';
    } else if (arg === '--sample-limit') {
      args.sampleLimit = Number(argv[++i] || 50);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/bigqueryRecoveryScan.js --uid <firebase-uid> [--out report.json]
`);
}

function tableRef(projectId, datasetId, tableId) {
  return `\`${projectId}.${datasetId}.${tableId}\``;
}

function rowToObject(schemaFields, row) {
  const out = {};
  (row.f || []).forEach((cell, index) => {
    out[schemaFields[index].name] = cell.v;
  });
  return out;
}

async function request(client, options) {
  const response = await client.request(options);
  return response.data;
}

async function listDatasets(client) {
  const data = await request(client, {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/datasets`,
    method: 'GET',
  });
  return data.datasets || [];
}

async function listTables(client, datasetId) {
  const data = await request(client, {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/datasets/${datasetId}/tables`,
    method: 'GET',
  });
  return data.tables || [];
}

async function getTable(client, datasetId, tableId) {
  return request(client, {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/datasets/${datasetId}/tables/${tableId}`,
    method: 'GET',
  });
}

async function runQuery(client, query, params = {}, timeoutMs = 20000) {
  const queryParameters = Object.entries(params).map(([name, value]) => ({
    name,
    parameterType: { type: typeof value === 'number' ? 'INT64' : 'STRING' },
    parameterValue: { value: String(value) },
  }));

  const data = await request(client, {
    url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
    method: 'POST',
    data: {
      query,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters,
      timeoutMs,
      maxResults: 1000,
    },
  });

  const schemaFields = data.schema?.fields || [];
  return {
    jobComplete: data.jobComplete,
    totalRows: Number(data.totalRows || 0),
    rows: (data.rows || []).map(row => rowToObject(schemaFields, row)),
    schema: schemaFields.map(field => ({ name: field.name, type: field.type })),
  };
}

function fieldNames(table) {
  return new Set((table.schema?.fields || []).map(field => field.name));
}

function isCandidateTable(table) {
  const fields = fieldNames(table);
  return fields.has('document_id') &&
    fields.has('user_id') &&
    fields.has('operation') &&
    (fields.has('raw_data') || fields.has('data'));
}

async function scanCandidateTable(client, table, args) {
  const { datasetId, tableId } = table.tableReference;
  const ref = tableRef(PROJECT_ID, datasetId, tableId);
  const fields = fieldNames(table);
  const timestampField = fields.has('bq_event_timestamp')
    ? 'bq_event_timestamp'
    : fields.has('timestamp')
      ? 'timestamp'
      : null;

  if (!timestampField) {
    return {
      table: `${datasetId}.${tableId}`,
      skipped: true,
      reason: 'No timestamp field found',
    };
  }

  const categoryExpr = fields.has('category') ? 'category' : 'NULL';
  const detectedTypeExpr = fields.has('detected_type') ? 'detected_type' : 'NULL';
  const imageUrlExpr = fields.has('image_url') ? 'image_url' : 'NULL';
  const rawDataExpr = fields.has('raw_data') ? 'raw_data' : fields.has('data') ? 'data' : 'NULL';

  const operationCounts = await runQuery(client, `
    SELECT
      operation,
      COUNT(1) AS count,
      MIN(${timestampField}) AS first_event,
      MAX(${timestampField}) AS last_event
    FROM ${ref}
    WHERE user_id = @uid
    GROUP BY operation
    ORDER BY operation
  `, { uid: args.uid });

  const latestSummary = await runQuery(client, `
    WITH ranked AS (
      SELECT
        document_id,
        operation,
        ${timestampField} AS event_timestamp,
        ${categoryExpr} AS category,
        ${detectedTypeExpr} AS detected_type,
        ${imageUrlExpr} AS image_url,
        ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY ${timestampField} DESC) AS rn
      FROM ${ref}
      WHERE user_id = @uid
    )
    SELECT
      COUNT(1) AS distinct_docs,
      COUNTIF(operation = 'DELETE') AS latest_deleted_docs,
      COUNTIF(operation != 'DELETE') AS latest_non_deleted_docs,
      COUNTIF(operation != 'DELETE' AND category IN ('Tops', 'Bottoms', 'Outerwear', 'Dresses', 'Shoes')) AS latest_non_deleted_clothing_docs,
      COUNTIF(operation != 'DELETE' AND category IN ('Accessories', 'Makeup')) AS latest_non_deleted_accessory_makeup_docs
    FROM ranked
    WHERE rn = 1
  `, { uid: args.uid });

  const latestSamples = await runQuery(client, `
    WITH ranked AS (
      SELECT
        document_id,
        operation,
        ${timestampField} AS event_timestamp,
        ${categoryExpr} AS category,
        ${detectedTypeExpr} AS detected_type,
        ${imageUrlExpr} AS image_url,
        ${rawDataExpr} AS raw_data,
        ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY ${timestampField} DESC) AS rn
      FROM ${ref}
      WHERE user_id = @uid
    )
    SELECT
      document_id,
      operation,
      event_timestamp,
      category,
      detected_type,
      image_url,
      raw_data
    FROM ranked
    WHERE rn = 1
    ORDER BY event_timestamp DESC
    LIMIT @sampleLimit
  `, { uid: args.uid, sampleLimit: args.sampleLimit });

  const likelyRecoverableClothingSamples = await runQuery(client, `
    WITH ranked AS (
      SELECT
        document_id,
        operation,
        ${timestampField} AS event_timestamp,
        ${categoryExpr} AS category,
        ${detectedTypeExpr} AS detected_type,
        ${imageUrlExpr} AS image_url,
        ${rawDataExpr} AS raw_data,
        ROW_NUMBER() OVER(PARTITION BY document_id ORDER BY ${timestampField} DESC) AS rn
      FROM ${ref}
      WHERE user_id = @uid
    )
    SELECT
      document_id,
      operation,
      event_timestamp,
      category,
      detected_type,
      image_url,
      raw_data
    FROM ranked
    WHERE rn = 1
      AND operation != 'DELETE'
      AND category IN ('Tops', 'Bottoms', 'Outerwear', 'Dresses', 'Shoes')
    ORDER BY event_timestamp DESC
    LIMIT @sampleLimit
  `, { uid: args.uid, sampleLimit: args.sampleLimit });

  return {
    table: `${datasetId}.${tableId}`,
    timestampField,
    rowCount: table.numRows,
    operationCounts: operationCounts.rows,
    latestSummary: latestSummary.rows[0] || {},
    latestSamples: latestSamples.rows,
    likelyRecoverableClothingSamples: likelyRecoverableClothingSamples.rows,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid) {
    printUsage();
    throw new Error('--uid is required');
  }

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const errors = [];
  const candidates = [];

  let datasets = [];
  try {
    datasets = await listDatasets(client);
  } catch (error) {
    errors.push({
      api: 'listDatasets',
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
  }

  for (const dataset of datasets) {
    const datasetId = dataset.datasetReference.datasetId;
    let tables = [];
    try {
      tables = await listTables(client, datasetId);
    } catch (error) {
      errors.push({
        api: 'listTables',
        datasetId,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      continue;
    }

    for (const listedTable of tables) {
      const tableId = listedTable.tableReference.tableId;
      try {
        const table = await getTable(client, datasetId, tableId);
        if (!isCandidateTable(table)) continue;
        candidates.push(await scanCandidateTable(client, table, args));
      } catch (error) {
        errors.push({
          api: 'scanTable',
          table: `${datasetId}.${tableId}`,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    uid: args.uid,
    datasetCount: datasets.length,
    candidateTableCount: candidates.length,
    candidates,
    errors,
  };

  const outputPath = args.out || path.join(
    process.cwd(),
    'recovery-reports',
    `bigquery-recovery-scan-${args.uid}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath: outputPath,
    datasetCount: report.datasetCount,
    candidateTableCount: report.candidateTableCount,
    candidates: candidates.map(candidate => ({
      table: candidate.table,
      operationCounts: candidate.operationCounts,
      latestSummary: candidate.latestSummary,
      likelyRecoverableClothingSampleCount: candidate.likelyRecoverableClothingSamples?.length || 0,
    })),
    errors,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
