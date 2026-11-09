import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const api = new UtilityManagerApiClient();
const utilityBillPath = '/utilityBillManagement';
const templatePath = '/utilityBillTemplate/templates';
const billFields = {
  Electric: { table: 'billing.utility_bill_electric', usage: 'total_kwh' },
  'Cold Water': { table: 'billing.utility_bill_cold_water', usage: 'total_usage' },
};

function billFixture(utility, { assignedTemplate = false } = {}) {
  const { table, usage } = billFields[utility];
  return cy.task('db:query', {
    sql: `SELECT v.id, v.utility_account_id, v.ypid, v.start_date, v.end_date, v.bill_date,
                 a.building_id, a.utility_id, a.account_id, a.ubt_template_id, u.utility_key,
                 d.total_cost, d.${usage} AS usage_value
          FROM billing.utility_bill_vw v JOIN billing.utility_account a ON a.id=v.utility_account_id
          JOIN core.building b ON b.id=a.building_id JOIN core.utility u ON u.id=a.utility_id
          JOIN ${table} d ON d.utility_bill_id=v.id
          WHERE a.is_offline=0 AND b.is_offline=0 AND v.ypid IS NOT NULL AND u.utility=?
            ${assignedTemplate ? `AND EXISTS (
              SELECT 1 FROM billing.ubt_template t
              WHERE t.id=a.ubt_template_id AND t.utility_id=a.utility_id AND t.is_offline=0
            )` : ''}
          ORDER BY v.id DESC LIMIT 1`,
    params: [utility],
  }, { log: false }).then(rows => {
    expect(rows, `saved ${utility} bill ${assignedTemplate ? 'with an active assigned template' : 'with details'}`).to.have.length(1);
    return rows[0];
  });
}

function assertUtilityAccounts(utility) {
  return billFixture(utility).then(({ building_id: buildingId, utility_id: utilityId }) => {
    return api.request('GET', `${utilityBillPath}/accounts/${buildingId}/${utilityId}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      for (const account of body) {
        expect(Number(account.building_id)).to.eq(Number(buildingId));
        expect(Number(account.utility_id)).to.eq(Number(utilityId));
      }
      return cy.task('db:query', {
        sql: `SELECT id AS utility_account_id, account_type, ubt_template_id, esco_reference_account, main_account_flag
              FROM billing.utility_account WHERE building_id=? AND utility_id=? AND is_offline=0`,
        params: [buildingId, utilityId],
      }, { log: false }).then(saved => {
        expect(body.map(account => Number(account.utility_account_id))).to.have.members(saved.map(account => Number(account.utility_account_id)));
        for (const account of body) {
          const expected = saved.find(row => Number(row.utility_account_id) === Number(account.utility_account_id));
          for (const field of ['account_type', 'ubt_template_id', 'main_account_flag']) {
            expect(String(account[field] ?? ''), field).to.eq(String(expected[field] ?? ''));
          }
          expect(String(account.esco_reference_account ?? '') === String(expected.esco_reference_account ?? ''), 'saved ESCO reference matches').to.eq(true);
        }
      });
    });
  });
}

function assertBillDetail(utility) {
  return billFixture(utility).then(saved => {
    return api.request('GET', `${utilityBillPath}/bills/${saved.id}/${saved.utility_key}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body[0], 'bill detail result set').to.be.an('array').and.have.length(1);
      const [bill] = body[0];
      expect(Number(bill.utility_bill_id)).to.eq(Number(saved.id));
      for (const field of ['start_date', 'end_date', 'bill_date']) {
        expect(bill[field]?.slice(0, 10) ?? null, field).to.eq(saved[field]);
      }
      for (const [field, value] of [['total_cost', saved.total_cost], [billFields[utility].usage, saved.usage_value]]) {
        expect(bill).to.have.property(field);
        expect(bill[field] == null ? null : Number(bill[field]), field).to.eq(value == null ? null : Number(value));
      }
    });
  });
}

function assertBillsForPeriod(utility) {
  return billFixture(utility).then(({ utility_account_id: accountId, ypid }) => {
    return api.request('GET', `${utilityBillPath}/bills/detail/${accountId}/${ypid}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      for (const bill of body) {
        expect(Number(bill.utility_account_id)).to.eq(Number(accountId));
        expect(Number(bill.ypid)).to.eq(Number(ypid));
      }
      return cy.task('db:query', {
        sql: 'SELECT id, billyear, billperiod, total_amount FROM billing.utility_bill_vw WHERE utility_account_id=? AND ypid=?',
        params: [accountId, ypid],
      }, { log: false }).then(saved => {
        const fields = bill => [Number(bill.id), Number(bill.billyear), Number(bill.billperiod), bill.total_amount == null ? null : Number(bill.total_amount)];
        expect(body.map(fields), 'exact bills for the account and period').to.have.deep.members(saved.map(fields));
      });
    });
  });
}

function assertInvalidLookup(utility, lookup) {
  return billFixture(utility).then(fixture => {
    const paths = {
      accounts: `accounts/not-a-building-id/${fixture.utility_id}`,
      detail: `bills/not-a-bill-id/${fixture.utility_key}`,
      period: `bills/detail/${fixture.utility_account_id}/not-a-period-id`,
      assignedTemplate: `bills/detail/bill/not-a-bill-id/${fixture.utility_key}/assigned-templates`,
    };
    return api.assertRejectedRead(`${utilityBillPath}/${paths[lookup]}`);
  });
}

function assertTemplateIdentity(template, fixture) {
  expect(Number(template.id), 'assigned template ID').to.eq(Number(fixture.ubt_template_id));
  expect(Number(template.utility_id), 'assigned template utility').to.eq(Number(fixture.utility_id));
  expect(template.sections).to.be.an('array').and.not.be.empty;
}

function assertOrder(rows, field) {
  expect(rows).to.be.an('array');
  const positions = rows.map(row => Number(row[field]));
  expect(positions.every(Number.isInteger), `valid ${field} values`).to.eq(true);
  expect(positions, `${field} order`).to.deep.eq([...positions].sort((a, b) => a - b));
}

function orderedTemplateFields(template) {
  assertOrder(template.sections, 'seq_no');
  return template.sections.flatMap(section => {
    assertOrder(section.rows, 'seq_no');
    return section.rows.flatMap(row => {
      assertOrder(row.fields, 'position_no');
      return row.fields;
    });
  });
}

function assertAssignedBillTemplate(utility) {
  return billFixture(utility, { assignedTemplate: true }).then(fixture => {
    const path = `${utilityBillPath}/bills/detail/bill/${fixture.id}/${fixture.utility_key}/assigned-templates`;
    return api.request('GET', path).then(({ status, body }) => {
      expect(status).to.eq(200);
      const { template, utility_bill_data: bill } = body.data;
      assertTemplateIdentity(template, fixture);
      expect(Number(bill.utility_bill_id)).to.eq(Number(fixture.id));
      const fields = orderedTemplateFields(template);
      const knownValues = { total_cost: fixture.total_cost, [billFields[utility].usage]: fixture.usage_value };
      const mapped = fields.filter(field => Object.hasOwn(knownValues, field.field_key));
      expect(mapped, 'configured cost or usage field').not.to.be.empty;
      for (const field of mapped) {
        const expected = knownValues[field.field_key];
        expect(field).to.have.property('value');
        if (expected == null) expect(field.value, field.field_key).to.be.null;
        else {
          expect(field.value, field.field_key).not.to.be.oneOf([null, undefined, '']);
          expect(Number(field.value), field.field_key).to.eq(Number(expected));
        }
      }
    });
  });
}

function assertUtilityTemplates(utility) {
  return billFixture(utility, { assignedTemplate: true }).then(fixture => {
    return api.request('GET', `${templatePath}?utility_id=${fixture.utility_id}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      const { templates } = body.data;
      expect(templates).to.be.an('array').and.not.be.empty;
      const ids = templates.map(template => Number(template.id));
      expect(new Set(ids).size).to.eq(ids.length);
      expect(ids).to.include(Number(fixture.ubt_template_id));
      for (const template of templates) expect(Number(template.utility_id)).to.eq(Number(fixture.utility_id));
    });
  });
}

function savedTemplates(utility) {
  return cy.task('db:query', {
    sql: `SELECT t.id, t.utility_id, t.is_offline
          FROM billing.ubt_template t JOIN core.utility u ON u.id=t.utility_id
          WHERE u.utility=? ORDER BY t.id`,
    params: [utility],
  }, { log: false });
}

function assertTemplateOfflineFilter(utility) {
  return savedTemplates(utility).then(saved => {
    const active = saved.filter(template => Number(template.is_offline) === 0);
    expect(active, `active ${utility} templates`).not.to.be.empty;
    expect(saved.some(template => Number(template.is_offline) === 1), `offline ${utility} template`).to.eq(true);
    const { utility_id: utilityId } = active[0];
    for (const includeOffline of [false, true]) {
      api.request('GET', `${templatePath}?utility_id=${utilityId}&is_offline_include=${includeOffline}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        const { templates } = body.data;
        expect(templates).to.be.an('array');
        const actual = templates.map(template => ({
          id: Number(template.id),
          utility_id: Number(template.utility_id),
          is_offline: Number(template.is_offline),
        }));
        expect(actual, `saved templates with is_offline_include=${includeOffline}`)
          .to.have.deep.members(includeOffline ? saved : active);
      });
    }
  });
}

function assertOfflineTemplateNotFound(utility) {
  return savedTemplates(utility).then(saved => {
    const offline = saved.find(template => Number(template.is_offline) === 1);
    expect(offline, `offline ${utility} template`).to.exist;
    return api.assertRejectedRead(`${templatePath}/${offline.id}`, [404]);
  });
}

function assertUtilityTemplateDetails(utility) {
  return billFixture(utility, { assignedTemplate: true }).then(fixture => {
    return api.request('GET', `${templatePath}/${fixture.ubt_template_id}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      const template = body.data;
      assertTemplateIdentity(template, fixture);
      expect(Number(template.is_offline)).to.eq(0);
      const fields = orderedTemplateFields(template);
      expect(fields, 'configured template fields').not.to.be.empty;
      return cy.task('db:query', {
        sql: `SELECT f.id, f.field_key, f.required_flag, f.data_type,
                     COALESCE(d.data_type, f.data_type) AS effective_data_type
              FROM billing.ubt_section s JOIN billing.ubt_row r ON r.section_id=s.id
              JOIN billing.ubt_field f ON f.row_id=r.id
              LEFT JOIN billing.ubt_field_def d ON d.id=f.field_def_id
              WHERE s.template_id=?`,
        params: [fixture.ubt_template_id],
      }, { log: false }).then(saved => {
        const savedById = new Map(saved.map(field => [Number(field.id), field]));
        expect(new Set(fields.map(field => Number(field.id))).size).to.eq(fields.length);
        for (const field of fields) {
          const expected = savedById.get(Number(field.id));
          expect(expected, `saved field ${field.id} belongs to the selected template`).to.exist;
          expect(field.field_key).to.eq(expected.field_key);
          expect(field.data_type).to.eq(expected.data_type);
          expect(field.effective_data_type).to.eq(expected.effective_data_type);
          expect(field).to.have.property('required_flag');
          expect(Number(field.required_flag)).to.eq(Number(expected.required_flag));
        }
      });
    });
  });
}

function assertUtilityTemplateFields(utility) {
  return billFixture(utility).then(({ utility_key: scope }) => {
    return api.request('GET', `${templatePath}/fields/${scope}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      const { fields } = body.data;
      expect(fields).to.be.an('array').and.not.be.empty;
      return cy.task('db:query', {
        sql: `SELECT id, field_key, label_default, utility_scope FROM billing.ubt_field_def
              WHERE is_active=1 AND utility_scope IN (?, 'any')`,
        params: [scope],
      }, { log: false }).then(saved => {
        const ids = fields.map(field => Number(field.id));
        expect(new Set(ids).size).to.eq(ids.length);
        expect(saved.some(field => field.utility_scope === scope && ids.includes(Number(field.id))), 'utility-specific field definitions').to.eq(true);
        for (const field of fields) {
          const expected = saved.find(row => Number(row.id) === Number(field.id));
          expect(expected, `active compatible field ${field.id}`).to.exist;
          expect(field).to.include({ field_key: expected.field_key, label_default: expected.label_default });
        }
      });
    });
  });
}

function assertTemplateForAccount(utility) {
  return billFixture(utility, { assignedTemplate: true }).then(fixture => {
    expect(Boolean(fixture.account_id?.trim()), 'saved account number is present').to.eq(true);
    const path = `${templatePath}/details/${encodeURIComponent(fixture.account_id)}`;
    return api.request('GET', path, undefined, { redactPath: true }).then(({ status, body }) => {
      expect(status).to.eq(200);
      assertTemplateIdentity(body.data.template, fixture);
    });
  });
}

describe('Utility Bill Read APIs', { tags: ['@api', '@utility-bill'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-064-POS - Electric: match accounts for the requested Building and utility', () => {
    return assertUtilityAccounts('Electric');
  });

  it('UM-API-064-POS - Cold Water: match accounts for the requested Building and utility', () => {
    return assertUtilityAccounts('Cold Water');
  });

  it('UM-API-064-NEG - Electric: reject a malformed Building ID in the account list', () => {
    return assertInvalidLookup('Electric', 'accounts');
  });

  it('UM-API-064-NEG - Cold Water: reject a malformed Building ID in the account list', () => {
    return assertInvalidLookup('Cold Water', 'accounts');
  });

  it('UM-API-065-POS - Electric: match bill details, dates, total cost and kWh', () => {
    return assertBillDetail('Electric');
  });

  it('UM-API-065-POS - Cold Water: match bill details, dates, total cost and usage', () => {
    return assertBillDetail('Cold Water');
  });

  it('UM-API-065-NEG - Electric: reject a malformed bill ID', () => {
    return assertInvalidLookup('Electric', 'detail');
  });

  it('UM-API-065-NEG - Cold Water: reject a malformed bill ID', () => {
    return assertInvalidLookup('Cold Water', 'detail');
  });

  it('UM-API-066-POS - Electric: match bills for the exact account and period', () => {
    return assertBillsForPeriod('Electric');
  });

  it('UM-API-066-POS - Cold Water: match bills for the exact account and period', () => {
    return assertBillsForPeriod('Cold Water');
  });

  it('UM-API-066-NEG - Electric: reject a malformed billing period ID', () => {
    return assertInvalidLookup('Electric', 'period');
  });

  it('UM-API-066-NEG - Cold Water: reject a malformed billing period ID', () => {
    return assertInvalidLookup('Cold Water', 'period');
  });

  it('UM-API-067-POS - Return unique line-item keys without bill values', () => {
    return api.request('GET', `${utilityBillPath}/bills/lineitems`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.not.be.empty;
      const keys = body.map(item => {
        expect(item.attribute_key).to.be.a('string').and.match(/\S/);
        expect(item).not.to.have.property('utility_bill_id');
        expect(item).not.to.have.property('attribute_value');
        return item.attribute_key;
      });
      expect(new Set(keys).size).to.eq(keys.length);
    });
  });

  it('UM-API-068-POS - Electric: match the assigned template order and mapped bill values', () => {
    return assertAssignedBillTemplate('Electric');
  });

  it('UM-API-068-POS - Cold Water: match the assigned template order and mapped bill values', () => {
    return assertAssignedBillTemplate('Cold Water');
  });

  it('UM-API-068-NEG - Electric: reject a malformed bill ID in the assigned-template lookup', () => {
    return assertInvalidLookup('Electric', 'assignedTemplate');
  });

  it('UM-API-068-NEG - Cold Water: reject a malformed bill ID in the assigned-template lookup', () => {
    return assertInvalidLookup('Cold Water', 'assignedTemplate');
  });

  it('UM-API-141-POS - Electric: list templates for the requested utility only', () => {
    return assertUtilityTemplates('Electric');
  });

  it('UM-API-141-POS - Cold Water: list templates for the requested utility only', () => {
    return assertUtilityTemplates('Cold Water');
  });

  it('UM-API-141-POS - Electric: include offline templates only when requested', () => {
    return assertTemplateOfflineFilter('Electric');
  });

  it('UM-API-141-POS - Cold Water: include offline templates only when requested', () => {
    return assertTemplateOfflineFilter('Cold Water');
  });

  it('UM-API-141-NEG - Reject a malformed utility ID in the template list', () => {
    return api.assertRejectedRead(`${templatePath}?utility_id=not-a-utility-id`, [400]);
  });

  it('UM-API-141-NEG - Reject a malformed offline filter in the template list', () => {
    return api.assertRejectedRead(`${templatePath}?is_offline_include=invalid`, [400]);
  });

  it('UM-API-141-NEG - Return an empty list for a blank utility filter', () => {
    return api.request('GET', `${templatePath}?utility_id=`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body.data.templates).to.deep.eq([]);
    });
  });

  it('UM-API-141-NEG - Return an empty list for an unknown numeric utility ID', () => {
    return cy.task('db:query', {
      sql: 'SELECT COALESCE(MAX(id), 0) + 1000000 AS missing_id FROM core.utility',
    }, { log: false }).then(([{ missing_id: id }]) => {
      return api.request('GET', `${templatePath}?utility_id=${id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body.data.templates).to.deep.eq([]);
      });
    });
  });

  it('UM-API-142-POS - Electric: match template details and ordered fields', () => {
    return assertUtilityTemplateDetails('Electric');
  });

  it('UM-API-142-POS - Cold Water: match template details and ordered fields', () => {
    return assertUtilityTemplateDetails('Cold Water');
  });

  it('UM-API-142-NEG - Reject a malformed template ID', () => {
    return api.assertRejectedRead(`${templatePath}/not-a-template-id`, [400]);
  });

  it('UM-API-142-NEG - Return not found for an unknown template ID', () => {
    return cy.task('db:query', {
      sql: 'SELECT COALESCE(MAX(id), 0) + 1000000 AS missing_id FROM billing.ubt_template',
    }, { log: false }).then(([{ missing_id: id }]) => {
      return api.assertRejectedRead(`${templatePath}/${id}`, [404]);
    });
  });

  it('UM-API-142-NEG - Electric: return not found for an offline template', () => {
    return assertOfflineTemplateNotFound('Electric');
  });

  it('UM-API-142-NEG - Cold Water: return not found for an offline template', () => {
    return assertOfflineTemplateNotFound('Cold Water');
  });

  it('UM-API-143-POS - Electric: return active compatible field definitions', () => {
    return assertUtilityTemplateFields('Electric');
  });

  it('UM-API-143-POS - Cold Water: return active compatible field definitions', () => {
    return assertUtilityTemplateFields('Cold Water');
  });

  it('UM-API-143-NEG - Reject an unsupported utility scope in the field list', () => {
    return api.assertRejectedRead(`${templatePath}/fields/not-a-utility-scope`, [400]);
  });

  it('UM-API-143-NEG - Reject a missing utility scope in the field list', () => {
    return api.assertRejectedRead(`${templatePath}/fields/`, [400]);
  });

  it('UM-API-144-POS - Electric: resolve the active template assigned to the account', () => {
    return assertTemplateForAccount('Electric');
  });

  it('UM-API-144-POS - Cold Water: resolve the active template assigned to the account', () => {
    return assertTemplateForAccount('Cold Water');
  });

  it('UM-API-144-NEG - Reject a malformed account ID in the template lookup', () => {
    return api.assertRejectedRead(`${templatePath}/details/not-an-account-id`);
  });
});
