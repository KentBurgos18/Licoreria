/**
 * Recalcula los saldos de créditos activos con la fórmula corregida.
 * Resetea a monto inicial, recalculando interés día por día (truncando correctamente).
 * Uso: node scripts/fix-credit-balances.js [tenantId]
 */
require('dotenv').config();
const { CustomerCredit, GroupPurchaseParticipant } = require('../models');
const CreditService = require('../services/CreditService');

async function main() {
  const tenantId = process.argv[2] ? parseInt(process.argv[2], 10) : 1;

  const credits = await CustomerCredit.findAll({
    where: { tenantId, status: 'ACTIVE' },
    include: [{ association: 'groupPurchaseParticipant' }]
  });

  if (credits.length === 0) {
    console.log('No hay créditos activos para corregir.');
    process.exit(0);
  }

  console.log(`Recalculando ${credits.length} crédito(s) activo(s)...`);

  for (const credit of credits) {
    const before = parseFloat(credit.currentBalance);
    const amountPaid = credit.groupPurchaseParticipant
      ? parseFloat(credit.groupPurchaseParticipant.amountPaid || 0)
      : 0;

    credit.currentBalance = parseFloat(credit.initialAmount);
    credit.lastInterestCalculationDate = null;
    await credit.save();

    const updated = await CreditService.updateCreditBalance(credit.id, new Date());
    let after = parseFloat(updated.currentBalance);

    if (amountPaid > 0) {
      after = Math.round((after - amountPaid) * 100) / 100;
      updated.currentBalance = after;
      await updated.save();
    }

    const diff = (after - before).toFixed(2);
    console.log(`  #${credit.id} ${credit.customerId || '?'}: $${before.toFixed(2)} → $${after.toFixed(2)} (${diff >= 0 ? '+' : ''}${diff})`);
  }

  console.log('Listo.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
