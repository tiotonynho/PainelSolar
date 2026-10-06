(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.PricingMoney=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
'use strict';

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function normalizeAmountText(value) {
  let text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!text) throw new TypeError('Valor monetário vazio');
  if (text.includes(',') && text.includes('.')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    throw new TypeError(`Valor monetário inválido: ${value}`);
  }
  return text;
}

function toCents(value, options = {}) {
  const {nullable = false, allowNegative = false} = options;
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new TypeError('Valor monetário obrigatório');
  }

  const text = normalizeAmountText(value);
  const negative = text.startsWith('-');
  if (negative && !allowNegative) throw new RangeError('Valor monetário não pode ser negativo');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const centsFraction = fraction.padEnd(2, '0').slice(0, 2);
  const shouldRoundUp = fraction.length > 2 && Number(fraction[2]) >= 5;
  let cents = BigInt(whole) * 100n + BigInt(centsFraction);
  if (shouldRoundUp) cents += 1n;
  if (negative) cents *= -1n;
  const result = Number(cents);
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_SAFE_CENTS) {
    throw new RangeError('Valor monetário excede a precisão segura');
  }
  return result;
}

function assertCents(value, name = 'centavos') {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} deve ser um inteiro seguro`);
  return value;
}

function addCents(...values) {
  const total = values.reduce((sum, value) => sum + assertCents(value), 0);
  return assertCents(total, 'Soma monetária');
}

function sumCents(values) {
  if (!Array.isArray(values)) throw new TypeError('A lista monetária deve ser um array');
  return addCents(...values);
}

function rateCents(baseCents, rate) {
  assertCents(baseCents, 'Base monetária');
  if (!Number.isFinite(rate)) throw new TypeError('Percentual inválido');
  const result = Math.round(baseCents * rate);
  return assertCents(result, 'Resultado monetário');
}

function fromCents(value) {
  return assertCents(value) / 100;
}

return {toCents, fromCents, assertCents, addCents, sumCents, rateCents};
});
