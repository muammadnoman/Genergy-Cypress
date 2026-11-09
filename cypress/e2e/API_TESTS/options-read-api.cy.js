import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();
const attributesPath = '/attributes';
const entityKeys = { Building: 'building', Portfolio: 'portfolio' };

function attributeFixture(entityType) {
  const key = entityKeys[entityType];
  return cy.task('db:query', {
    sql: `SELECT id, ${key}_id, attribute_key, attribute_value
          FROM core.${key}_attribute WHERE COALESCE(is_offline,0)=0 ORDER BY id DESC LIMIT 1`,
  }, { log: false }).then(rows => {
    expect(rows, `saved active ${entityType} attribute`).to.have.length(1);
    return rows[0];
  });
}

function assertAttributeResponse(response) {
  expect(response.status).to.eq(200);
  expect(response.body.status).to.eq('success');
  expect(response.body.message).to.be.a('string').and.match(/\S/);
  expect(response.body.data).to.be.an('array').and.not.be.empty;
  return response.body.data;
}

function assertEntityAttributes(entityType) {
  const key = entityKeys[entityType];
  const parentKey = `${key}_id`;
  return attributeFixture(entityType).then(fixture => {
    const parentId = fixture[parentKey];
    return cy.task('db:query', {
      sql: `SELECT id, ${parentKey}, attribute_key, attribute_value FROM core.${key}_attribute
            WHERE ${parentKey}=? AND COALESCE(is_offline,0)=0`,
      params: [parentId],
    }, { log: false }).then(saved => {
      return api.request('GET', `${attributesPath}/${entityType}/entity/${parentId}`).then(response => {
        const items = assertAttributeResponse(response);
        expect(response.body.count).to.eq(saved.length);
        expect(items.map(item => item.id)).to.have.members(saved.map(row => row.id));
        for (const item of items) {
          expect(item.is_offline).to.eq(0);
          expect(item).to.include(saved.find(row => row.id === item.id));
        }
      });
    });
  });
}

function assertAttributeKeys(entityType) {
  const key = entityKeys[entityType];
  return cy.task('db:query', {
    sql: `SELECT DISTINCT attribute_key FROM core.${key}_attribute WHERE COALESCE(is_offline,0)=0`,
  }, { log: false }).then(saved => {
    return api.request('GET', `${attributesPath}/${entityType}`).then(response => {
      const items = assertAttributeResponse(response);
      expect(response.body.count).to.eq(saved.length);
      expect(items.map(item => item.attribute_key)).to.have.members(saved.map(row => row.attribute_key));
    });
  });
}

function assertAttributeDetail(entityType) {
  return attributeFixture(entityType).then(saved => {
    return api.request('GET', `${attributesPath}/${entityType}/${saved.id}`).then(response => {
      const items = assertAttributeResponse(response);
      expect(items).to.have.length(1);
      expect(items[0]).to.include({ ...saved, attribute_id: saved.id, entity_type: entityType, is_offline: 0 });
    });
  });
}

describe('Options Read APIs', { tags: ['@api', '@options'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-155-POS - Return only the selected Portfolio attributes', () => assertEntityAttributes('Portfolio'));
  it('UM-API-155-POS - Return only the selected Building attributes', () => assertEntityAttributes('Building'));

  it('UM-API-155-NEG - Reject an unsupported entity type in an entity lookup', () => {
    return api.assertRejectedRead(`${attributesPath}/Unsupported/entity/1`, [400]);
  });

  it('UM-API-155-NEG - Return not found for an unknown Building', () => {
    return cy.task('db:query', { sql: 'SELECT COALESCE(MAX(id),0)+1000000 AS missing_id FROM core.building' }, { log: false })
      .then(([{ missing_id: id }]) => api.assertRejectedRead(`${attributesPath}/Building/entity/${id}`, [404]));
  });

  it('UM-API-156-POS - Match the distinct active Portfolio attribute keys', () => assertAttributeKeys('Portfolio'));
  it('UM-API-156-POS - Match the distinct active Building attribute keys', () => assertAttributeKeys('Building'));

  it('UM-API-156-NEG - Reject an unsupported entity type in the attribute key list', () => {
    return api.assertRejectedRead(`${attributesPath}/Unsupported`, [400]);
  });

  it('UM-API-157-POS - Return the exact Portfolio attribute and its entity type', () => assertAttributeDetail('Portfolio'));
  it('UM-API-157-POS - Return the exact Building attribute and its entity type', () => assertAttributeDetail('Building'));

  it('UM-API-157-NEG - Return not found for an unknown attribute ID', () => {
    return cy.task('db:query', { sql: 'SELECT COALESCE(MAX(id),0)+1000000 AS missing_id FROM core.building_attribute' }, { log: false })
      .then(([{ missing_id: id }]) => api.assertRejectedRead(`${attributesPath}/Building/${id}`, [404]));
  });
});
