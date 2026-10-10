/**
 * MULE SHIELD Client-Side CSV Validation Module
 * Validates uploaded CSV files for required columns and data type integrity
 * before transmitting to the Python analytical backend.
 */

const REQUIRED_CANONICAL_COLUMNS = ['transaction_id', 'sender_id', 'receiver_id', 'amount', 'timestamp'];

const ALIAS_MAP = {
  transaction_id: ['transaction_id', 'tx_id', 'id', 'trans_id', 'txid', 'transactionid'],
  sender_id: ['sender_id', 'sender', 'from', 'source', 'originator', 'from_account', 'senderid'],
  receiver_id: ['receiver_id', 'receiver', 'to', 'destination', 'beneficiary', 'to_account', 'receiverid'],
  amount: ['amount', 'amt', 'value', 'sum', 'trans_amount', 'tx_amount'],
  timestamp: ['timestamp', 'time', 'date', 'created_at', 'trans_time', 'datetime', 'epoch'],
  is_laundering: ['is_laundering', 'label', 'is_fraud', 'fraud', 'laundering', 'target']
};

function validateCsvContent(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      missingRequiredColumns: REQUIRED_CANONICAL_COLUMNS,
      errors: ['File is empty. No CSV headers or data rows found.'],
      warnings: [],
      validRowsCount: 0
    };
  }

  const headerTokens = lines[0].split(',').map(h => h.trim().toLowerCase());
  const detectedCanonical = {};
  const recognizedAliases = {};

  headerTokens.forEach((rawHeader, idx) => {
    for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
      if (aliases.includes(rawHeader) && !detectedCanonical[canonical]) {
        detectedCanonical[canonical] = idx;
        recognizedAliases[rawHeader] = canonical;
        break;
      }
    }
  });

  const missingRequired = REQUIRED_CANONICAL_COLUMNS.filter(col => detectedCanonical[col] === undefined);
  const errors = [];
  const warnings = [];

  if (missingRequired.length > 0) {
    errors.push(`Missing required column(s): ${missingRequired.join(', ')}. Supported aliases: transaction_id, sender_id, receiver_id, amount, timestamp.`);
  }

  const dataRows = lines.slice(1);
  const seenTxIds = new Set();
  let validRowsCount = 0;

  const txIdIdx = detectedCanonical['transaction_id'];
  const senderIdx = detectedCanonical['sender_id'];
  const receiverIdx = detectedCanonical['receiver_id'];
  const amountIdx = detectedCanonical['amount'];
  const timeIdx = detectedCanonical['timestamp'];
  const labelIdx = detectedCanonical['is_laundering'];

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const tokens = row.split(',').map(t => t.trim());
    let rowHasError = false;

    // Check column completeness
    if (tokens.length < headerTokens.length) {
      errors.push(`Row ${rowNum}: Incomplete columns (expected ${headerTokens.length}, found ${tokens.length})`);
      rowHasError = true;
    }

    // Check transaction_id integrity
    if (txIdIdx !== undefined && txIdIdx < tokens.length) {
      const txId = tokens[txIdIdx];
      if (!txId) {
        errors.push(`Row ${rowNum}: Empty transaction_id identifier.`);
        rowHasError = true;
      } else if (seenTxIds.has(txId)) {
        warnings.push(`Row ${rowNum}: Duplicate transaction_id '${txId}' detected.`);
      } else {
        seenTxIds.add(txId);
      }
    }

    // Check sender_id & receiver_id integrity
    let sender = '';
    let receiver = '';
    if (senderIdx !== undefined && senderIdx < tokens.length) {
      sender = tokens[senderIdx];
      if (!sender) {
        errors.push(`Row ${rowNum}: Empty sender_id.`);
        rowHasError = true;
      }
    }
    if (receiverIdx !== undefined && receiverIdx < tokens.length) {
      receiver = tokens[receiverIdx];
      if (!receiver) {
        errors.push(`Row ${rowNum}: Empty receiver_id.`);
        rowHasError = true;
      }
    }
    if (sender && receiver && sender === receiver) {
      warnings.push(`Row ${rowNum}: Self-loop transfer (sender and receiver both '${sender}').`);
    }

    // Check amount data type integrity
    if (amountIdx !== undefined && amountIdx < tokens.length) {
      const amtStr = tokens[amountIdx];
      const amt = parseFloat(amtStr);
      if (isNaN(amt)) {
        errors.push(`Row ${rowNum}: Invalid numeric amount '${amtStr}'.`);
        rowHasError = true;
      } else if (amt <= 0) {
        errors.push(`Row ${rowNum}: Non-positive amount ${amt} (must be strictly > 0).`);
        rowHasError = true;
      }
    }

    // Check timestamp data type integrity
    if (timeIdx !== undefined && timeIdx < tokens.length) {
      const timeStr = tokens[timeIdx];
      if (timeStr) {
        const epoch = parseInt(timeStr, 10);
        const parsedDate = isNaN(epoch) ? Date.parse(timeStr) : epoch;
        if (isNaN(parsedDate)) {
          warnings.push(`Row ${rowNum}: Timestamp '${timeStr}' is not recognized ISO-8601 or epoch millis.`);
        }
      }
    }

    // Check label integrity if present
    if (labelIdx !== undefined && labelIdx < tokens.length) {
      const label = tokens[labelIdx].toLowerCase();
      if (label && !['0', '1', 'true', 'false', 'yes', 'no'].includes(label)) {
        warnings.push(`Row ${rowNum}: Unrecognized binary laundering label '${label}'.`);
      }
    }

    if (!rowHasError) {
      validRowsCount++;
    }
  });

  return {
    isValid: errors.length === 0,
    totalRows: lines.length,
    dataRowsCount: dataRows.length,
    validRowsCount: validRowsCount,
    missingRequiredColumns: missingRequired,
    recognizedAliases: recognizedAliases,
    errors: errors,
    warnings: warnings
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateCsvContent };
}
