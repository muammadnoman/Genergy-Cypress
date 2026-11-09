import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { buildingData } from '../../data/qaData';

const api = new UtilityManagerApiClient();
const billPeriodPath = '/billPeriodManagement';
const tripCodesPath = `${billPeriodPath}/trip-codes`;

function billPeriodsPath(buildingNumber, utilityId) {
  return `${billPeriodPath}/bill-periods/${encodeURIComponent(buildingNumber)}/${utilityId}`;
}

function periodFields(period) {
  return {
    billyear: Number(period.billyear),
    billperiod: Number(period.billperiod),
    date_start: period.date_start.slice(0, 10),
    date_end: period.date_end.slice(0, 10),
  };
}

function assertBillPeriods(utilityName) {
  return cy.task('db:query', {
    sql: `SELECT p.building_number, p.utility_id FROM billing.billyrperiod p
          JOIN core.building b ON b.building_number=p.building_number
          JOIN core.utility u ON u.id=p.utility_id
          WHERE b.is_offline=0 AND p.is_offline=0 AND u.utility=?
          ORDER BY p.ypid LIMIT 1`,
    params: [utilityName],
  }, { log: false }).then(rows => {
    expect(rows, `active Building with ${utilityName} bill periods`).to.have.length(1);
    const { building_number: buildingNumber, utility_id: utilityId } = rows[0];
    return api.request('GET', billPeriodsPath(buildingNumber, utilityId)).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      for (const period of body) {
        expect(period.building_number).to.eq(buildingNumber);
        expect(Number(period.utility_id)).to.eq(Number(utilityId));
      }
      return cy.task('db:query', {
        sql: `SELECT billyear, billperiod, date_start, date_end, source_type FROM billing.billyrperiod
              WHERE building_number=? AND utility_id=? AND is_offline=0`,
        params: [buildingNumber, utilityId],
      }, { log: false }).then(saved => {
        const fields = period => ({ ...periodFields(period), source_type: period.source_type });
        expect(body.map(fields), 'active bill periods and their saved dates').to.have.deep.members(saved.map(fields));
      });
    });
  });
}

function assertUnknownBillPeriodBuilding(utilityName) {
  const { number } = buildingData();
  cy.task('db:building', number, { log: false }).should('have.length', 0);
  return api.request('GET', '/associated/utility_id_names').then(({ body }) => {
    const utility = body.find(row => row.utility === utilityName);
    expect(utility, `${utilityName} reference`).to.exist;
    return api.assertRejectedRead(billPeriodsPath(number, utility.utility_id));
  });
}

function tripCodeFixture(utilityName) {
  return cy.task('db:query', {
    sql: `SELECT v.trip_code_group_id, v.utility_provider_id, v.region_id, v.utility_id, v.trip_code
          FROM billing.trip_code_details_vw v JOIN core.utility u ON u.id=v.utility_id
          WHERE u.utility=? ORDER BY v.region_id, v.utility_provider_id, v.trip_code LIMIT 1`,
    params: [utilityName],
  }, { log: false }).then(rows => {
    expect(rows, `configured ${utilityName} trip code`).to.have.length(1);
    return rows[0];
  });
}

function assertTripCodeList(utilityName) {
  return tripCodeFixture(utilityName).then(({ region_id: regionId, utility_id: utilityId }) => {
    return api.request('GET', `${billPeriodPath}/trip-codes/list/${regionId}/${utilityId}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      for (const code of body) {
        expect(Number(code.region_id)).to.eq(Number(regionId));
        expect(Number(code.utility_id)).to.eq(Number(utilityId));
      }
      return cy.task('db:query', {
        sql: 'SELECT trip_code_group_id, utility_provider_id, trip_code FROM billing.trip_code_all_vw WHERE region_id=? AND utility_id=?',
        params: [regionId, utilityId],
      }, { log: false }).then(saved => {
        const identity = code => [Number(code.trip_code_group_id), Number(code.utility_provider_id), Number(code.trip_code)];
        expect(body.map(identity), 'compatible trip-code choices').to.have.deep.members(saved.map(identity));
      });
    });
  });
}

function assertTripCodesByYear(utilityName) {
  return cy.task('db:query', {
    sql: `SELECT g.utility_provider_id, g.region_id, g.utility_id, t.billyear
          FROM billing.trip_code t JOIN billing.trip_code_group g ON g.id=t.trip_code_group_id
          JOIN core.utility u ON u.id=g.utility_id
          WHERE t.is_offline=0 AND u.utility=? AND t.billyear BETWEEN 2000 AND YEAR(CURRENT_DATE)
          ORDER BY t.billyear DESC, t.id LIMIT 1`,
    params: [utilityName],
  }, { log: false }).then(rows => {
    expect(rows, `${utilityName} trip codes in a current or historical bill year`).to.have.length(1);
    const { utility_provider_id: providerId, region_id: regionId, utility_id: utilityId, billyear: year } = rows[0];
    return api.request('GET', `${tripCodesPath}/${providerId}/${regionId}/${utilityId}/${year}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      return cy.task('db:query', {
        sql: `SELECT t.id, t.trip_code_group_id, t.trip_code, t.billyear, t.billperiod, t.date_start, t.date_end
              FROM billing.trip_code t JOIN billing.trip_code_group g ON g.id=t.trip_code_group_id
              WHERE g.utility_provider_id=? AND g.region_id=? AND g.utility_id=? AND t.billyear=? AND t.is_offline=0`,
        params: [providerId, regionId, utilityId, year],
      }, { log: false }).then(saved => {
        const fields = row => ({
          id: Number(row.id),
          trip_code_group_id: Number(row.trip_code_group_id),
          trip_code: Number(row.trip_code),
          ...periodFields(row),
        });
        expect(body.map(fields), 'exact periods for the requested provider, region, utility and year')
          .to.have.deep.members(saved.map(fields));
      });
    });
  });
}

function assertInvalidTripCodeLookup(utilityName, lookup) {
  return tripCodeFixture(utilityName).then(({ utility_provider_id: providerId, region_id: regionId, utility_id: utilityId }) => {
    const scope = `${providerId}/${regionId}/${utilityId}`;
    const paths = {
      year: `${scope}/not-a-year`,
      list: `list/not-a-region/${utilityId}`,
      detail: `details/${scope}/not-a-code`,
    };
    return api.assertRejectedRead(`${tripCodesPath}/${paths[lookup]}`);
  });
}

function assertTripCodeDetail(utilityName) {
  return tripCodeFixture(utilityName).then(fixture => {
    const { utility_provider_id: providerId, region_id: regionId, utility_id: utilityId, trip_code: code } = fixture;
    return api.request('GET', `${billPeriodPath}/trip-codes/details/${providerId}/${regionId}/${utilityId}/${code}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.have.length(1);
      const [detail] = body;
      for (const key of ['trip_code_group_id', 'utility_provider_id', 'region_id', 'utility_id', 'trip_code']) {
        expect(Number(detail[key]), key).to.eq(Number(fixture[key]));
      }
      expect(detail.trip_code_json).to.be.an('array').and.not.be.empty;
      return cy.task('db:query', {
        sql: `SELECT id, billyear, billperiod, date_start, date_end FROM billing.trip_code
              WHERE trip_code_group_id=? AND trip_code=? AND is_offline=0`,
        params: [fixture.trip_code_group_id, code],
      }, { log: false }).then(saved => {
        const actual = detail.trip_code_json.map(period => ({ id: Number(period.trip_code_id), ...periodFields(period) }));
        const expected = saved.map(period => ({ id: Number(period.id), ...periodFields(period) }));
        expect(actual, 'exact trip-code periods and dates').to.have.deep.members(expected);
      });
    });
  });
}

describe('Bill Period Read APIs', { tags: ['@api', '@bill-period'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-047-POS - Electric: match the Building bill periods and saved dates', () => {
    return assertBillPeriods('Electric');
  });

  it('UM-API-047-POS - Cold Water: match the Building bill periods and saved dates', () => {
    return assertBillPeriods('Cold Water');
  });

  it('UM-API-047-NEG - Electric: reject a bill period lookup for an unknown Building', () => {
    return assertUnknownBillPeriodBuilding('Electric');
  });

  it('UM-API-047-NEG - Cold Water: reject a bill period lookup for an unknown Building', () => {
    return assertUnknownBillPeriodBuilding('Cold Water');
  });

  it('UM-API-050-POS - Electric: match trip periods for the requested provider, region and bill year', () => {
    return assertTripCodesByYear('Electric');
  });

  it('UM-API-050-POS - Cold Water: match trip periods for the requested provider, region and bill year', () => {
    return assertTripCodesByYear('Cold Water');
  });

  it('UM-API-050-NEG - Electric: reject a malformed bill year', () => {
    return assertInvalidTripCodeLookup('Electric', 'year');
  });

  it('UM-API-050-NEG - Cold Water: reject a malformed bill year', () => {
    return assertInvalidTripCodeLookup('Cold Water', 'year');
  });

  it('UM-API-051-POS - Electric: list trip codes for the requested region and utility', () => {
    return assertTripCodeList('Electric');
  });

  it('UM-API-051-POS - Cold Water: list trip codes for the requested region and utility', () => {
    return assertTripCodeList('Cold Water');
  });

  it('UM-API-051-NEG - Electric: reject a malformed region in the trip-code list', () => {
    return assertInvalidTripCodeLookup('Electric', 'list');
  });

  it('UM-API-051-NEG - Cold Water: reject a malformed region in the trip-code list', () => {
    return assertInvalidTripCodeLookup('Cold Water', 'list');
  });

  it('UM-API-052-POS - Electric: match the selected trip code and its saved periods', () => {
    return assertTripCodeDetail('Electric');
  });

  it('UM-API-052-POS - Cold Water: match the selected trip code and its saved periods', () => {
    return assertTripCodeDetail('Cold Water');
  });

  it('UM-API-052-NEG - Electric: reject a malformed trip code in the detail lookup', () => {
    return assertInvalidTripCodeLookup('Electric', 'detail');
  });

  it('UM-API-052-NEG - Cold Water: reject a malformed trip code in the detail lookup', () => {
    return assertInvalidTripCodeLookup('Cold Water', 'detail');
  });

  it('UM-API-053-POS - Return unique utility providers with saved codes, names and websites', () => {
    return api.request('GET', `${billPeriodPath}/utility-provider/list`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      expect(new Set(body.map(provider => Number(provider.id))).size).to.eq(body.length);
      return cy.task('db:query', {
        sql: 'SELECT id, provider_code, provider_name, website FROM billing.utility_provider',
      }, { log: false }).then(saved => {
        for (const provider of body) {
          expect(Number(provider.id)).to.be.greaterThan(0);
          const expected = saved.find(row => Number(row.id) === Number(provider.id));
          expect(expected, `saved provider ${provider.id}`).to.exist;
          for (const key of ['provider_code', 'provider_name', 'website']) expect(provider[key], key).to.eq(expected[key]);
        }
      });
    });
  });
});
