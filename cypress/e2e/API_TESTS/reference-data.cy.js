import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();

describe('Reference Data APIs', { tags: ['@api', '@reference'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-013-POS - Billing Template Details: valid request', () => {
    api.assertReferenceData('/associated/billing_template_details', 'billing_template_id', 'billing_template');
  });

  it('UM-API-014-POS - Region Details: valid request', () => {
    api.assertReferenceData('/associated/region_details', 'region_id', 'region');
  });

  it('UM-API-015-POS - Property Type Details: valid request', () => {
    api.assertReferenceData('/associated/property_type_details', 'property_type_id', 'property_type');
  });

  it('UM-API-017-POS - Utility Id and Names: valid request', { tags: '@smoke' }, () => {
    api.assertReferenceData('/associated/utility_id_names', 'utility_id', 'utility');
  });

  it('UM-API-018-POS - Get Lease Types And Ids: valid request', () => {
    api.assertReferenceData('/associated/leaseTypes/list', 'lease_type_id', 'lease_type');
  });

  it('UM-API-019-POS - Electric: list compatible meter types', () => {
    api.assertMeterTypes('Electric', 'Electric Base Meter', /^Electric\b/i);
  });

  it('UM-API-019-POS - Cold Water: list compatible meter types', () => {
    api.assertMeterTypes('Cold Water', 'Water Base Meter', /^(?:Cold )?Water\b/i);
  });

  it('UM-API-020-POS - Electric: list compatible New York City rates', () => {
    api.assertCompatibleRates('Electric', 'New York City');
  });

  it('UM-API-020-POS - Cold Water: list compatible New York City rates', () => {
    api.assertCompatibleRates('Cold Water', 'New York City');
  });
});
