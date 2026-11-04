// Prints the protocol table for NOTES.md, generated from the definitions in
// server/protocol.js. Usage: node tools/protocol-table.mjs
// (A unit test fails if the table embedded in NOTES.md drifts from this.)
import { protocolTable } from '../server/protocol.js';
console.log(protocolTable());
