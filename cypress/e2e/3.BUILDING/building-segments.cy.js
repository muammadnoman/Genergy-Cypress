import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { OptionsPage } from '../../../pageObjects/OptionsPage';
import { LettersPage } from '../../../pageObjects/LettersPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, recordData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const notes = new NotesPage('Building');
const parentNotes = new NotesPage();
const options = new OptionsPage('Building');
const letters = new LettersPage('Building');
const api = new UtilityManagerApiClient();

describe('Building Notes, Options and Letters', { tags: ['@building', '@ui'] }, () => {
  beforeEach(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => {
      cy.wrap(parent, { log: false }).as('parent');
      for (const alias of ['building', 'sibling']) {
        buildings.create(buildingData(), parent.id).then(saved => cy.wrap(saved, { log: false }).as(alias));
      }
    });
  });

  it('UM-NOTE-005 - Show a building note in its portfolio without leaking to unrelated records', { tags: '@notes' }, () => {
    cy.get('@building').then(building => {
      const data = { ...recordData('Note'), kind: 'note' };
      data.body = data.name;
      notes.open(building.id);
      notes.create(building, data).then(() => {
        notes.open(building.id, [data]);
        cy.get('@parent').then(parent => parentNotes.open(parent.id, [{ ...data, entityType: 'Building', entityId: building.id }]));
        cy.get('@sibling').then(sibling => notes.open(sibling.id));
        api.createPortfolio(portfolioData()).then(other => parentNotes.open(other.id));
      });
    });
  });

  it('UM-NOTE-012 - Save and edit building notes and tickets in the correct building', { tags: '@notes' }, () => {
    cy.get('@building').then(building => {
      const expected = [];
      notes.open(building.id);
      for (const kind of ['note', 'ticket']) {
        const data = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind };
        data.body = data.name;
        notes.create(building, data, { validateRequired: true }).then(saved => {
          expected.push(data);
          notes.open(building.id, expected);
          notes.edit({ ...data, id: saved.id, entityId: building.id }, { cancel: true });
          notes.open(building.id, expected);
          notes.edit({ ...data, id: saved.id, entityId: building.id });
          data.body = `${data.name} Updated`;
          if (kind === 'ticket') Object.assign(data, { status: 'closed', priority: 'low' });
          notes.open(building.id, expected);
        });
      }
      cy.get('@sibling').then(sibling => notes.open(sibling.id));
    });
  });

  it('UM-OPT-002 - Save, edit, cancel and delete a building attribute without changing its sibling', { tags: '@options' }, () => {
    cy.get('@building').then(building => {
      const key = recordData('Attribute').name;
      options.open(building.id);
      options.create(building.id, key, 'Cancelled', { cancel: true, validateRequired: true });
      options.open(building.id);
      options.create(building.id, key, 'Original');
      options.open(building.id);
      options.edit(key, 'Cancelled edit', { cancel: true });
      options.open(building.id);
      options.assertAttribute(building.id, key, { attribute_value: 'Original' });
      options.edit(key, '0');
      options.open(building.id);
      options.assertAttribute(building.id, key, { attribute_value: '0' });
      cy.get('@sibling').then(sibling => options.open(sibling.id, key));
      options.open(building.id);
      options.delete(key, { cancel: true });
      options.open(building.id);
      options.delete(key);
      options.open(building.id, key);
      options.assertAttribute(building.id, key, { is_offline: 1 });
    });
  });

  it('UM-LTR-002 - Preview a building letter, validate recipients and cancel without sending', { tags: '@letters' }, () => {
    cy.get('@building').then(building => {
      letters.openPreview(building.id);
      letters.validateRecipientsAndCancel(building.id);
    });
  });
});
