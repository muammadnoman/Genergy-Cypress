import { faker } from '@faker-js/faker';

export const supportedUtilities = ['Electric', 'Cold Water'];

export function recordData(type) {
  if (!/^[A-Z][A-Za-z]+$/.test(type)) throw new Error('Use a record type such as Portfolio, Building or Tenant.');
  const { id, prefix } = Cypress.expose('run') || {};
  if (!/^[a-f0-9]{12}$/.test(id) || prefix !== `Auto_${id}_`) {
    throw new Error('Fixture run context is invalid. Generate records only after fixtures:run synchronizes the active run.');
  }
  return {
    number: `${prefix}${faker.string.alphanumeric(6)}`,
    name: `Auto_${type}_${id}_${faker.company.name().replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 95),
  };
}

export function portfolioData() { return recordData('Portfolio'); }

export function buildingData() {
  return {
    ...recordData('Building'),
    street: faker.location.streetAddress().slice(0, 45),
    city: 'New York',
    state: 'NY',
    zip: '10001',
    company: faker.company.name().slice(0, 90),
    adminFee: '12.34',
    addOnFee: '2.50',
  };
}

export function tenantData({ useDefaultDates = false } = {}) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const nextYear = new Date(now);
  nextYear.setFullYear(now.getFullYear() + 1);
  const [defaultStart, defaultEnd] = [now, nextYear].map(date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  return {
    ...recordData('Tenant'), email: '',
    street: faker.location.streetAddress().slice(0, 90), city: 'New York', state: 'NY', zip: '10001',
    taxExempt: '0', lmepExempt: '0', location: recordData('Lease').name.slice(0, 80),
    startDate: useDefaultDates ? defaultStart : `${now.getFullYear()}-${month}-01`,
    endDate: useDefaultDates ? defaultEnd : `${now.getFullYear() + 1}-${month}-28`,
    sqft: '1200', occupancy: '3', adminFee: '12.34', setupCharge: '5.50', reviewCharge: '0',
  };
}

export function leaseUtilityData(value = '12.34') {
  return { lease_utility_admin_fee: value, lease_utility_addon_fee: '2.50', lmep_credit: '1', coincident_demand: '1',
    external_fee_percentage: value, trans_fee_percentage: value, lmep_rate_percentage: value,
    billing_fee_adj_percentage: value, overhead_profit_percentage: value };
}
