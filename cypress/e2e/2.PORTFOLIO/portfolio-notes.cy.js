import { LoginPage } from '../../../pageObjects/LoginPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, recordData } from '../../data/qaData';

const login = new LoginPage();
const notes = new NotesPage();
const api = new UtilityManagerApiClient();

describe('Portfolio Notes and Tickets', { tags: ['@portfolio', '@notes', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-NOTE-011 - Create a portfolio note and ticket and keep them out of another portfolio', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      api.createPortfolio(portfolioData()).then(other => {
        const savedNotes = [];
        notes.open(parent.id);
        for (const kind of ['note', 'ticket']) {
          const data = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind };
          data.body = data.name;
          notes.create(parent, data, { validateRequired: true }).then(saved => {
            savedNotes.push({ body: data.body, kind });
            notes.open(parent.id, savedNotes);
          });
        }
        notes.open(other.id);
      });
    });
  });

  it('UM-NOTE-021 - Search and filter portfolio notes and tickets, then reset', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const note = { ...recordData('Note'), kind: 'note' };
      const ticket = { ...recordData('Ticket'), kind: 'ticket' };
      note.body = note.name;
      ticket.body = ticket.name;
      notes.open(parent.id);
      notes.create(parent, note).then(() => {
        notes.create(parent, ticket).then(() => {
          notes.open(parent.id, [note, ticket]);
          notes.filter(parent.id, note, ticket);
        });
      });
    });
  });

  it('UM-NOTE-022 - Edit a portfolio ticket and preserve its ID, owner and kind', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const data = { ...recordData('Ticket'), kind: 'ticket' };
      data.body = data.name;
      notes.open(parent.id);
      notes.create(parent, data).then(saved => {
        const ticket = { ...data, id: saved.id, entityId: parent.id };
        notes.open(parent.id, [ticket]);
        notes.edit(ticket, { cancel: true });
        notes.open(parent.id, [ticket]);
        notes.edit(ticket);
        notes.open(parent.id, [{ ...ticket, body: `${data.name} Updated`, status: 'closed', priority: 'low' }]);
      });
    });
  });

  it('UM-NOTE-023 - Delete only the selected portfolio note and preserve its ticket', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const note = { ...recordData('Note'), kind: 'note' };
      const ticket = { ...recordData('Ticket'), kind: 'ticket' };
      note.body = note.name;
      ticket.body = ticket.name;
      notes.open(parent.id);
      notes.create(parent, note).then(saved => {
        notes.create(parent, ticket).then(() => {
          notes.open(parent.id, [note, ticket]);
          notes.delete({ ...note, id: saved.id });
          notes.open(parent.id, [ticket]);
        });
      });
    });
  });

  it('UM-NOTE-024 - Recover from failed note and ticket saves without losing saved data', { tags: '@negative' }, () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const expected = [];
      for (const kind of ['note', 'ticket']) {
        const data = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind };
        data.body = data.name;
        // Queue each kind after the previous kind has updated the expected timeline.
        cy.then(() => {
          notes.open(parent.id, expected);
          notes.create(parent, data, { reject: true });
          notes.open(parent.id, expected);
          notes.create(parent, data, { retry: true }).then(saved => {
            const original = { ...data, id: saved.id, entityId: parent.id };
            expected.push(original);
            notes.open(parent.id, expected);
            notes.edit(original, { reject: true });
            notes.open(parent.id, expected);
            notes.edit(original);
            const updated = { ...original, body: `${data.name} Updated` };
            if (kind === 'ticket') Object.assign(updated, { status: 'closed', priority: 'low' });
            expected[expected.length - 1] = updated;
            notes.open(parent.id, expected);
            // A rejected delete must preserve the entry; positive deletion is UM-NOTE-023.
            notes.delete(updated, { reject: true });
            notes.open(parent.id, expected);
          });
        });
      }
    });
  });
});
