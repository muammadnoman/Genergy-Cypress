import { LoginPage } from '../../../pageObjects/LoginPage';
import { LettersPage } from '../../../pageObjects/LettersPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData } from '../../data/qaData';

const login = new LoginPage();
const letters = new LettersPage();
const api = new UtilityManagerApiClient();

describe('Portfolio Letters', { tags: ['@portfolio', '@letters', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-NOTE-009 - Validate Portfolio letter recipients and cancel without sending', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      letters.openPreview(parent.id);
      letters.validateRecipientsAndCancel(parent.id);
    });
  });
});
