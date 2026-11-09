import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData } from '../../data/qaData';

const api = new UtilityManagerApiClient();
const entityTypes = ['portfolio', 'building', 'tenant'];
const templatesPath = '/letterTemplate/templates';

function letterTemplates(path) {
  return api.request('GET', path).then(({ status, body }) => {
    expect(status).to.eq(200);
    expect(body.data).to.be.an('array');
    for (const template of body.data) {
      expect(Number(template.id), 'template ID').to.be.greaterThan(0);
      expect(template.name).to.be.a('string').and.match(/\S/);
      expect(template.entity_type).to.be.a('string').and.match(/\S/);
    }
    expect(new Set(body.data.map(template => Number(template.id))).size).to.eq(body.data.length);
    return body.data;
  });
}

describe('Letter Read APIs', { tags: ['@api', '@letters'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-161-POS - Filter letter templates by Portfolio, Building and Tenant', () => {
    return letterTemplates(templatesPath).then(all => {
      expect(all, 'configured letter templates').not.to.be.empty;
      for (const type of entityTypes) {
        letterTemplates(`${templatesPath}?entity_type=${type}`).then(filtered => {
          const expected = all.filter(template => template.entity_type.toLowerCase() === type);
          expect(filtered.map(template => Number(template.id)), `${type} template IDs`)
            .to.have.members(expected.map(template => Number(template.id)));
          for (const template of filtered) expect(template.entity_type.toLowerCase()).to.eq(type);
        });
      }
    });
  });

  it('UM-API-161-NEG - Reject an unsupported template entity type', () => {
    return api.assertRejectedRead(`${templatesPath}?entity_type=invalid-entity-type`);
  });

  it('UM-API-162-POS - Return the selected Portfolio template with subject, body and placeholders', () => {
    return letterTemplates(`${templatesPath}?entity_type=portfolio`).then(templates => {
      expect(templates, 'configured Portfolio template').not.to.be.empty;
      const [template] = templates;
      return api.request('GET', `${templatesPath}/${template.id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        const detail = body.data;
        expect(Number(detail.id)).to.eq(Number(template.id));
        expect(detail).to.include({ name: template.name, entity_type: template.entity_type });
        expect(detail.entity_type.toLowerCase()).to.eq('portfolio');
        for (const field of ['subject_tpl', 'message_tpl']) {
          expect(detail[field], field).to.be.a('string').and.match(/\S/);
          expect(detail[field], field).to.eq(template[field]);
        }
        expect(detail.tag_keys_json).to.be.an('array').and.deep.eq(template.tag_keys_json);
      });
    });
  });

  it('UM-API-162-NEG - Reject a malformed template ID', () => {
    return api.assertRejectedRead(`${templatesPath}/not-an-id`);
  });

  it('UM-API-166-POS - List placeholder keys and examples for supported entity types', () => {
    for (const type of entityTypes) {
      api.request('GET', `/letterTemplate/tags/${type}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body.data, `${type} placeholder tags`).to.be.an('array').and.not.be.empty;
        const keys = body.data.map(tag => {
          expect(tag.tag_key).to.be.a('string').and.match(/\S/);
          expect(tag.example_value).to.be.a('string');
          return tag.tag_key;
        });
        expect(new Set(keys).size, `${type} has unique placeholder keys`).to.eq(keys.length);
      });
    }
  });

  it('UM-API-166-NEG - Reject an unsupported placeholder entity type', () => {
    return api.assertRejectedRead('/letterTemplate/tags/invalid-entity-type');
  });

  it('UM-API-167-POS - Return empty letter history for a new Portfolio', () => {
    return api.createPortfolio(portfolioData()).then(portfolio => {
      return api.request('GET', `/letterTemplate/emails/history/portfolio/${portfolio.id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body.data).to.deep.eq([]);
      });
    });
  });

  it('UM-API-167-NEG - Reject a malformed Portfolio ID in the letter history request', () => {
    return api.assertRejectedRead('/letterTemplate/emails/history/portfolio/not-an-id');
  });

  it('UM-API-170-POS - Return no assigned recipients for a new Portfolio', () => {
    return api.createPortfolio(portfolioData()).then(portfolio => {
      return api.request('GET', `/letterTemplate/recipients/portfolio/${portfolio.id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body.data).to.deep.eq([]);
      });
    });
  });

  it('UM-API-170-NEG - Reject a malformed Portfolio ID in a recipient lookup', () => {
    return api.assertRejectedRead('/letterTemplate/recipients/portfolio/not-an-id');
  });
});
