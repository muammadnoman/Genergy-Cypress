import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();

describe('Dashboard APIs', { tags: ['@dashboard', '@api'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-174-POS - Return numeric KPI populations for a fixed date', () => {
    api.request('GET', '/dashboard/kpi?date=2026-10-17').then(({ status, body }) => {
      expect(status).to.eq(200);
      for (const key of ['open_tickets', 'this_month_tickets', 'total_meters_active', 'total_realtime_meters_active']) {
        expect(body.data[key].count).to.be.a('number').and.be.at.least(0);
        expect(body.data[key].percentage_change).to.be.a('string').and.match(/^[+-]?\d+(\.\d+)?%$/);
      }
    });
  });

  it('UM-API-175-POS - Return reading KPI and building/meter populations', () => {
    api.request('GET', '/dashboard/recent-meter-readings?date=2026-10-17').then(({ status, body }) => {
      expect(status).to.eq(200);
      for (const key of ['last_24_hours', 'last_7_days', 'meter_reading_alerts']) expect(body.data.kpis[key]).to.be.a('number').and.be.at.least(0);
      expect(body.data.buildings).to.be.an('array');
      for (const building of body.data.buildings) {
        expect(building.building_id).to.exist;
        expect(building.meters).to.be.an('array');
        expect(new Set(building.meters.map(m => m.meter_id)).size).to.eq(building.meters.length);
        for (const meter of building.meters) expect(meter.building_id).to.eq(building.building_id);
      }
    });
  });

  it('UM-API-174-NEG - Reject malformed and impossible KPI dates', () => {
    for (const date of ['not-a-date', '2026-02-30']) {
      api.request('GET', `/dashboard/kpi?date=${date}`, undefined, { allowedStatuses: [400, 422] });
    }
  });

  it('UM-API-175-NEG - Reject malformed and impossible readings dates', () => {
    for (const date of ['not-a-date', '2026-02-30']) {
      api.request('GET', `/dashboard/recent-meter-readings?date=${date}`, undefined, { allowedStatuses: [400, 422] });
    }
  });

  it('UM-API-176-POS - Enforce search group limits and consistent result metadata', () => {
    for (const [filter, limit] of [['portfolio,building,tenant,meter', 10], ['portfolio,building,tenant', 13], ['portfolio,building', 20], ['portfolio', 40]]) {
      api.request('GET', `/dashboard/search?search=Auto_&filter=${encodeURIComponent(filter)}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body.metadata.per_entity_limit).to.eq(limit);
        let total = 0;
        for (const [key, records] of Object.entries(body.data)) {
          expect(records).to.be.an('array');
          expect(records.length, key).to.be.at.most(limit);
          if (!filter.split(',').includes(key.replace(/s$/, ''))) expect(records, `excluded ${key}`).to.have.length(0);
          total += records.length;
        }
        expect(total).to.be.at.most(40);
        expect(body.metadata.total_results).to.eq(total);
      });
    }
  });

  it('UM-API-176-NEG - Reject short search terms and unsupported entity filters', () => {
    for (const query of ['search=a', 'search=ab', 'search=Auto_&filter=not-a-real-entity']) {
      api.request('GET', `/dashboard/search?${query}`, undefined, { allowedStatuses: [400, 422] }).then(({ body }) => {
        expect(JSON.stringify(body)).to.match(/search|filter|invalid|characters|length/i);
      });
    }
  });
});
