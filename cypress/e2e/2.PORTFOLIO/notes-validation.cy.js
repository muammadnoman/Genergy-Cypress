import { LoginPage } from '../../../pageObjects/LoginPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, recordData } from '../../data/qaData';

const login = new LoginPage();
const notes = new NotesPage();
const api = new UtilityManagerApiClient();

describe('Shared Notes and Ticket Validation', { tags: ['@portfolio', '@notes', '@ui'] }, () => {
  beforeEach(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => cy.wrap(parent, { log: false }).as('parent'));
  });

  it('UM-NOTE-001 - Save a note without title or tags and reopen it', function () {
    const data = { ...recordData('Note'), kind: 'note' };
    data.body = data.name;
    notes.open(this.parent.id);
    notes.create(this.parent, data).then(() => notes.open(this.parent.id, [data]));
  });

  it('UM-NOTE-002 - Block an empty note body, then save a valid note', function () {
    const data = { ...recordData('Note'), kind: 'note' };
    data.body = data.name;
    notes.open(this.parent.id);
    notes.create(this.parent, data, { validateRequired: true }).then(() => notes.open(this.parent.id, [data]));
  });

  it('UM-NOTE-003 - Require ticket assignee and priority before saving', function () {
    const data = { ...recordData('Ticket'), kind: 'ticket' };
    data.body = data.name;
    notes.open(this.parent.id);
    notes.create(this.parent, data, { validateRequired: true }).then(() => notes.open(this.parent.id, [data]));
  });
});
