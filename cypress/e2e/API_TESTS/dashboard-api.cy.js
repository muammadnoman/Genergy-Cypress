import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();
const defaultFeedLimit = 25;

function employeeFeed(limit, offset) {
  const query = new URLSearchParams({ offset: String(offset) });
  if (limit !== undefined) query.set('limit', String(limit));
  return api.request('GET', `/employee-feed/list?${query}`).then(({ status, body }) => {
    expect(status).to.eq(200);
    expect(body.success).to.eq(true);
    expect(body.data).to.be.an('array');
    expect(body.count).to.be.a('number').and.be.at.least(offset + body.data.length);
    expect(body.data.length).to.be.at.most(Number.isInteger(limit) ? limit : defaultFeedLimit);
    return body.data;
  });
}

describe('Dashboard APIs', { tags: ['@dashboard', '@api'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-173-POS - List employee feed entries newest-first with the requested limit and offset', { tags: '@employee-feed' }, () => {
    return employeeFeed(6, 0).then(first => {
      expect(first, 'feed entries for pagination').to.have.length(6);
      const ids = first.map(entry => Number(entry.feed_id));
      for (const id of ids) expect(id, 'feed ID').to.be.greaterThan(0);
      expect(new Set(ids).size).to.eq(ids.length);
      const dates = first.map(entry => Date.parse(entry.created_at));
      for (const date of dates) expect(Number.isFinite(date), 'valid feed timestamp').to.eq(true);
      expect(dates).to.deep.eq([...dates].sort((a, b) => b - a));
      return employeeFeed(5, 1).then(next => {
        expect(next.map(entry => Number(entry.feed_id))).to.deep.eq(ids.slice(1));
      });
    });
  });

  it('UM-API-173-NEG - Use the default employee feed limit for nonnumeric input', { tags: '@employee-feed' }, () => {
    return employeeFeed(undefined, 0).then(defaultPage => {
      expect(defaultPage, 'default page with enough staging feed entries').to.have.length(defaultFeedLimit);
      return employeeFeed('not-a-number', 0).then(page => {
        expect(page.map(entry => entry.feed_id)).to.deep.eq(defaultPage.map(entry => entry.feed_id));
      });
    });
  });

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

  it('UM-API-177-POS - Return only active open tickets created by the requested user', () => {
    return cy.task('db:query', {
      sql: `SELECT n.id, n.created_by FROM core.note n JOIN core.building b ON b.id=n.entity_id
            WHERE n.entity_type='Building' AND n.kind='ticket' AND n.status='open'
              AND n.is_active=1 AND n.created_by>0 AND b.is_offline=0
            ORDER BY n.id DESC LIMIT 1`,
    }, { log: false }).then(rows => {
      expect(rows, 'active open Building ticket with a creator').to.have.length(1);
      const [fixture] = rows;
      return api.request('GET', `/dashboard/notes-alert/user-open/${fixture.created_by}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(Number(body.metadata.user_id)).to.eq(Number(fixture.created_by));
        const { notes } = body.data;
        expect(notes).to.be.an('array').and.not.be.empty;
        expect(notes.map(note => Number(note.note_id ?? note.id))).to.include(Number(fixture.id));
        for (const note of notes) {
          expect(Number(note.created_by), 'ticket creator').to.eq(Number(fixture.created_by));
          expect(note.kind).to.eq('ticket');
          expect(note.status).to.eq('open');
          expect(Number(note.is_active)).to.eq(1);
        }
      });
    });
  });

  it('UM-API-177-NEG - Reject a malformed open-ticket user ID', () => {
    return api.assertRejectedRead('/dashboard/notes-alert/user-open/not-an-id');
  });
});
