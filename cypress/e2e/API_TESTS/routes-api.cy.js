import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();

describe('Route Management APIs', { tags: ['@api', '@routes'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-178-POS - List routes: valid request', () => {
    api.request('GET', '/routes').then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body.results).to.be.an('array');
      expect(body.page).to.be.a('number').and.be.greaterThan(0);
      expect(body.page_size).to.be.a('number').and.be.greaterThan(0);
      expect(body.total).to.be.a('number').and.be.at.least(body.results.length);
    });
  });
});
