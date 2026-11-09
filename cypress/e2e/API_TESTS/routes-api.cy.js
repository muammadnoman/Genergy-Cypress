import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();

function routeResults(path) {
  return api.request('GET', path).then(({ status, body }) => {
    expect(status).to.eq(200);
    expect(body.results, `${path} results`).to.be.an('array');
    return body.results;
  });
}

function assertUniqueIds(rows, field) {
  const ids = rows.map(row => Number(row[field]));
  for (const id of ids) expect(id, field).to.be.greaterThan(0);
  expect(new Set(ids).size, `unique ${field} values`).to.eq(ids.length);
}

describe('Route Management APIs', { tags: ['@api', '@routes'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-178-POS - List routes: valid request', () => {
    api.request('GET', '/routes').then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body.results).to.be.an('array');
      expect(body.page).to.be.a('number').and.be.greaterThan(0);
      expect(body.page_size).to.be.a('number').and.be.greaterThan(0);
      expect(body.total).to.be.a('number').and.be.at.least(body.results.length);
      expect(body.results.length).to.be.at.most(body.page_size);
      assertUniqueIds(body.results, 'id');
      for (const route of body.results) {
        expect(route.route_code).to.be.a('string').and.match(/\S/);
        expect(route.route_name).to.be.a('string').and.match(/\S/);
        expect(route.status).to.be.a('string').and.match(/\S/);
        expect(route.building_count).to.be.a('number').and.be.at.least(0);
        expect(route.buildings).to.be.an('array');
        expect(route).to.have.property('current_reader');
        expect(route).to.have.property('next_read_date');
        if (route.next_read_date !== null) {
          expect(route.next_read_date).to.be.a('string');
          expect(Number.isFinite(Date.parse(route.next_read_date)), 'valid next read date').to.eq(true);
        }
      }
    });
  });

  it('UM-API-178-NEG - Reject invalid route pagination', () => {
    return api.assertRejectedRead('/routes?page=not-a-number');
  });

  it('UM-API-180-POS - Return unique Building options with their assignment state', () => {
    return routeResults('/routes/building-options').then(buildings => {
      expect(buildings, 'configured Building options').not.to.be.empty;
      assertUniqueIds(buildings, 'building_id');
      for (const building of buildings) {
        expect(building.building_number).to.be.a('string').and.match(/\S/);
        expect(building.building_name).to.be.a('string').and.match(/\S/);
        expect(building.is_assigned).to.eq(building.route_id === null ? 0 : 1);
        if (building.is_assigned === 1) expect(Number(building.route_id)).to.be.greaterThan(0);
      }
    });
  });

  it('UM-API-180-NEG - Reject a malformed route ID in the Building picker', () => {
    return api.assertRejectedRead('/routes/building-options?route_id=not-an-id');
  });

  it('UM-API-181-POS - Return only trips that overlap the requested calendar month', () => {
    const today = new Date();
    const month = today.toISOString().slice(0, 7);
    const firstDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const nextMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    return routeResults(`/routes/schedule?month=${month}`).then(trips => {
      assertUniqueIds(trips, 'schedule_id');
      for (const trip of trips) {
        const start = Date.parse(trip.start_date.slice(0, 10));
        const end = Date.parse(trip.end_date.slice(0, 10));
        expect(start, `trip ${trip.schedule_id} starts before the next month`).to.be.lessThan(nextMonth);
        expect(end, `trip ${trip.schedule_id} ends in or after the requested month`).to.be.at.least(firstDay);
        expect(end, `trip ${trip.schedule_id} date order`).to.be.at.least(start);
      }
    });
  });

  it('UM-API-181-NEG - Reject an impossible schedule month', () => {
    return api.assertRejectedRead('/routes/schedule?month=2026-13');
  });

  it('UM-API-182-POS - Return upcoming trips for the requested meter reader', () => {
    return routeResults('/meter-readers').then(readers => {
      expect(readers, 'configured meter reader roster').not.to.be.empty;
      const reader = readers.find(item => item.upcoming_trip_count > 0) ?? readers[0];
      return routeResults(`/routes/schedule?reader_id=${reader.id}&upcoming=true`).then(trips => {
        expect(trips).to.have.length(reader.upcoming_trip_count);
        assertUniqueIds(trips, 'schedule_id');
        for (const trip of trips) expect(Number(trip.reader.id)).to.eq(Number(reader.id));
      });
    });
  });

  it('UM-API-182-NEG - Reject a malformed schedule reader ID', () => {
    return api.assertRejectedRead('/routes/schedule?reader_id=not-an-id&upcoming=true');
  });

  it('UM-API-183-NEG - Reject a malformed route detail ID', () => {
    return api.assertRejectedRead('/routes/not-an-id');
  });

  it('UM-API-189-POS - Return unique reader and account IDs with valid trip counts', () => {
    return routeResults('/meter-readers').then(readers => {
      expect(readers, 'configured meter reader roster').not.to.be.empty;
      assertUniqueIds(readers, 'id');
      assertUniqueIds(readers, 'account_id');
      for (const reader of readers) {
        expect(reader.name).to.be.a('string').and.match(/\S/);
        expect(reader.upcoming_trip_count).to.be.a('number').and.be.at.least(0);
        expect(Number.isInteger(reader.upcoming_trip_count)).to.eq(true);
      }
    });
  });

  it('UM-API-190-POS - Mark existing readers as already assigned in the candidate list', () => {
    return routeResults('/meter-readers').then(readers => {
      const assignedAccounts = new Set(readers.map(reader => Number(reader.account_id)));
      return routeResults('/meter-readers/candidates').then(candidates => {
        expect(candidates, 'configured reader candidates').not.to.be.empty;
        assertUniqueIds(candidates, 'userid');
        for (const candidate of candidates) {
          expect(candidate.is_reader).to.eq(assignedAccounts.has(Number(candidate.userid)) ? 1 : 0);
        }
      });
    });
  });
});
