const { getStore } = require('@netlify/blobs');

function documentsStore() {
  return getStore('license-documents');
}

module.exports = { documentsStore };
