/**
 * STAYOS — tenantPlugin.js
 * src/plugins/tenantPlugin.js
 *
 * Globales Mongoose Plugin — tenantId Enforcement
 * Wird via mongoose.plugin() VOR allen Model-Registrierungen geladen.
 *
 * Abgedeckte Hooks:
 *   find · findOne · findOneAndUpdate · findOneAndDelete
 *   countDocuments · updateMany · deleteMany · aggregate · save
 *
 * Verhalten bei fehlendem tenantId:
 *   → Error wird geworfen, Query wird blockiert, NIEMALS ausgeführt
 */

'use strict';

// ─── Query-Hooks ────────────────────────────────────────────────────────────
const QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'countDocuments',
  'updateMany',
  'deleteMany',
];

// ─── Plugin ─────────────────────────────────────────────────────────────────
function tenantPlugin(schema) {
  // strict: true — unbekannte Felder werden abgelehnt (nicht stillschweigend ignoriert)
  schema.set('strict', true);

  // ── Query Hooks (find, findOne, etc.) ──────────────────────────────────
  QUERY_HOOKS.forEach((hook) => {
    schema.pre(hook, function () {
      const query = this.getQuery();

      if (!query.tenantId) {
        const modelName = this.model?.modelName || 'unknown';
        throw new Error(
          `[STAYOS Security] tenantId fehlt in "${hook}" Query — BLOCKIERT. ` +
          `Model: ${modelName}. ` +
          `Jede MongoDB-Query MUSS { tenantId } enthalten.`
        );
      }
    });
  });

  // ── Aggregate Hook ─────────────────────────────────────────────────────
  // Erste Pipeline-Stage MUSS ein $match mit tenantId sein.
  schema.pre('aggregate', function () {
    const pipeline = this.pipeline();
    const firstStage = pipeline[0];

    const hastenantIdMatch =
      firstStage &&
      firstStage.$match &&
      firstStage.$match.tenantId;

    if (!hastenantIdMatch) {
      throw new Error(
        '[STAYOS Security] Aggregation blockiert — erste Pipeline-Stage ' +
        'muss { $match: { tenantId: ... } } sein. ' +
        `Erster Stage: ${JSON.stringify(firstStage ?? null)}`
      );
    }
  });

  // ── Save Hook ──────────────────────────────────────────────────────────
  schema.pre('save', function () {
    if (!this.tenantId) {
      const modelName = this.constructor?.modelName || 'unknown';
      throw new Error(
        `[STAYOS Security] save() blockiert — tenantId fehlt im Dokument. ` +
        `Model: ${modelName}. ` +
        `Setze doc.tenantId vor dem Speichern.`
      );
    }
  });
}

module.exports = tenantPlugin;
