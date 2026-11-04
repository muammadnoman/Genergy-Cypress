import { LoginPage } from '../../../pageObjects/LoginPage';
import { OptionsPage } from '../../../pageObjects/OptionsPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, recordData } from '../../data/qaData';

const login = new LoginPage();
const options = new OptionsPage();
const api = new UtilityManagerApiClient();

describe('Portfolio Options', { tags: ['@portfolio', '@options', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-OPT-001 - Save, edit and delete a portfolio attribute without changing another portfolio', () => {
    const key = recordData('Attribute').name;
    api.createPortfolio(portfolioData()).then(parent => {
      api.createPortfolio(portfolioData()).then(other => {
        options.open(parent.id);
        options.create(parent.id, key, 'Initial value', { validateRequired: true });
        options.open(parent.id);
        options.edit(key, '0');
        options.open(parent.id);
        options.assertAttribute(parent.id, key, { attribute_value: '0' });
        options.open(other.id, key);
        options.open(parent.id);
        options.delete(key, { cancel: true });
        options.open(parent.id);
        options.delete(key);
        options.open(parent.id);
        options.assertAttribute(parent.id, key, { is_offline: 1 });
        options.open(other.id, key);
        options.assertAttribute(other.id, key, null);
      });
    });
  });

  it('UM-OPT-006 - Cancel attribute creation and editing without changing saved values', () => {
    const key = recordData('Attribute').name;
    api.createPortfolio(portfolioData()).then(parent => {
      options.open(parent.id);
      options.create(parent.id, key, 'Cancelled', { cancel: true, validateRequired: true });
      options.open(parent.id);
      options.create(parent.id, key, 'Original');
      options.open(parent.id);
      options.edit(key, 'Cancelled edit', { cancel: true });
      options.open(parent.id);
      options.assertAttribute(parent.id, key, { attribute_value: 'Original' });
    });
  });
});
