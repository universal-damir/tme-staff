/**
 * Screen texts of the eKYC client form that are not in the contract
 * (buttons, save state, upload messages, link pages). English first, German
 * in the Sie form, written by us like the other `deReviewed: false` German
 * in src/types/ekyc.ts. No em or en dashes.
 */
import type { EkycText } from '@/types/ekyc';

const t = (en: string, de: string): EkycText => ({ en, de, deReviewed: false });

export const EKYC_UI = {
  brand: t('TME Services eKYC', 'TME Services eKYC'),
  loading: t('Loading...', 'Wird geladen...'),
  select: t('Please select', 'Bitte auswählen'),
  selectCountries: t('Select one or more countries', 'Ein oder mehrere Länder auswählen'),
  typeToSearch: t('Type to search...', 'Zum Suchen tippen...'),
  noOptions: t('No options found', 'Keine Treffer'),
  optional: t('Optional', 'Optional'),
  remove: t('Remove', 'Entfernen'),

  // Phone and money fields
  phonePlaceholder: t('Phone number', 'Telefonnummer'),
  searchCountry: t('Search country...', 'Land suchen...'),
  noCountries: t('No countries found', 'Keine Länder gefunden'),
  phoneSavedAs: t(
    'Saved earlier as: {value}. Please choose the country and enter the number again.',
    'Früher gespeichert als: {value}. Bitte wählen Sie das Land und geben Sie die Nummer erneut ein.'
  ),
  currency: t('Currency', 'Währung'),
  amount: t('Amount', 'Betrag'),

  // List of activities (kind 'lines'): one box per activity
  addLine: t('Add activity', 'Tätigkeit hinzufügen'),
  lineLabel: t('Activity {n}', 'Tätigkeit {n}'),
  removeLine: t('Remove activity {n}', 'Tätigkeit {n} entfernen'),

  // Draft
  saveDraft: t('Save draft', 'Entwurf speichern'),
  saving: t('Saving...', 'Wird gespeichert...'),
  saved: t('Saved', 'Gespeichert'),
  notSaved: t('Not saved yet. We keep trying.', 'Noch nicht gespeichert. Wir versuchen es weiter.'),
  tooLarge: t(
    'Your entries are too large to save. Please shorten the longest answers.',
    'Ihre Angaben sind zu umfangreich zum Speichern. Bitte kürzen Sie die längsten Antworten.'
  ),

  // Submit
  submit: t('Submit', 'Absenden'),
  submitting: t('Submitting...', 'Wird abgesendet...'),
  confirmTitle: t('Submit the form?', 'Formular absenden?'),
  confirmSubmit: t('Yes, submit', 'Ja, absenden'),
  cancel: t('Cancel', 'Abbrechen'),
  missingTitle: t(
    'Please complete the following before you submit:',
    'Bitte vervollständigen Sie vor dem Absenden Folgendes:'
  ),
  submitFailed: t(
    'The form could not be submitted. Please try again in a moment.',
    'Das Formular konnte nicht abgesendet werden. Bitte versuchen Sie es gleich noch einmal.'
  ),
  submitChanged: t(
    'The form changed while it was being sent (for example a file was still uploading). Nothing is lost. Please try again.',
    'Das Formular hat sich während des Absendens geändert (zum Beispiel wurde noch eine Datei hochgeladen). Es ist nichts verloren. Bitte versuchen Sie es erneut.'
  ),
  waitForUpload: t(
    'Please wait until the upload is finished.',
    'Bitte warten Sie, bis das Hochladen abgeschlossen ist.'
  ),

  // Uploads
  upload: t('Upload file', 'Datei hochladen'),
  replace: t('Replace file', 'Datei ersetzen'),
  uploading: t('Uploading...', 'Wird hochgeladen...'),
  onFile: t('On file', 'Hochgeladen'),
  view: t('View', 'Ansehen'),
  maxSize: t('Each file up to 4.5 MB.', 'Jede Datei bis zu 4,5 MB.'),
  wrongType: t('Please upload a PDF, JPG or PNG file.', 'Bitte laden Sie eine PDF-, JPG- oder PNG-Datei hoch.'),
  tooBig: t(
    'The file is larger than 4.5 MB. Please upload a smaller PDF or a photo.',
    'Die Datei ist größer als 4,5 MB. Bitte laden Sie eine kleinere PDF-Datei oder ein Foto hoch.'
  ),
  uploadFailed: t('The upload did not work. Please try again.', 'Das Hochladen hat nicht funktioniert. Bitte versuchen Sie es erneut.'),

  // Signature pad (shared SignaturePad, bilingual texts)
  signDraw: t('Draw your signature', 'Bitte hier unterschreiben'),
  signSaved: t('Signature saved', 'Unterschrift gespeichert'),
  signEdit: t('Edit', 'Bearbeiten'),
  signUndo: t('Undo', 'Rückgängig'),
  signClear: t('Clear', 'Löschen'),

  // Date picker (shared CustomDatePicker, bilingual texts)
  dateToday: t('Today', 'Heute'),
  dateClear: t('Clear', 'Löschen'),
  datePlaceholder: t('dd.mm.yyyy', 'TT.MM.JJJJ'),

  // Steps and navigation (Good Services: one topic per step, always a way back)
  stepOf: t('Step {n} of {total}', 'Schritt {n} von {total}'),
  steps: t('Steps', 'Schritte'),
  showSteps: t('Show all steps', 'Alle Schritte anzeigen'),
  hideSteps: t('Hide steps', 'Schritte ausblenden'),
  back: t('Back', 'Zurück'),
  continue: t('Continue', 'Weiter'),
  checkAnswersButton: t('Check your answers', 'Angaben prüfen'),
  stepDone: t('Complete', 'Vollständig'),
  stepErrors: t('Needs attention', 'Bitte prüfen'),
  stepTodo: t('Not complete yet', 'Noch nicht vollständig'),
  stepCurrent: t('You are here', 'Sie sind hier'),
  stepErrorTitle: t('Please check these answers:', 'Bitte prüfen Sie diese Angaben:'),
  stepPrefillLine: t(
    'Some answers on this page were filled in by TME Services. Please check them.',
    'Einige Angaben auf dieser Seite hat TME Services vorausgefüllt. Bitte prüfen Sie sie.'
  ),
  prefilledTag: t('Pre-filled', 'Vorausgefüllt'),
  moreInfo: t('More information', 'Weitere Informationen'),

  // Start screen
  startIntroCorporate: t(
    'TME Services needs to know who owns and runs your company. The law requires this check (KYC) for every client.',
    'TME Services muss wissen, wem Ihr Unternehmen gehört und wer es führt. Diese Prüfung (KYC) ist für alle Kunden gesetzlich vorgeschrieben.'
  ),
  startIntroIndividual: t(
    'TME Services needs to know who you are and where your money comes from. The law requires this check (KYC) for every client.',
    'TME Services muss wissen, wer Sie sind und woher Ihr Geld stammt. Diese Prüfung (KYC) ist für alle Kunden gesetzlich vorgeschrieben.'
  ),
  startNeedTitle: t('What you need', 'Was Sie benötigen'),
  startNeedLicense: t('Your trade license (all licenses, if you have more than one)', 'Ihre Handelslizenz (alle Lizenzen, falls Sie mehrere haben)'),
  startNeedOwners: t(
    'Names of all shareholders and UBOs, exactly as shown in their passports',
    'Die Namen aller Gesellschafter und wirtschaftlich Berechtigten (UBO) genau wie im Reisepass'
  ),
  startNeedCapital: t('The authorized and issued share capital', 'Das genehmigte und das eingezahlte Stammkapital'),
  startNeedContact: t('Contact details and the office addresses', 'Kontaktdaten und die Büroadressen'),
  startNeedPassport: t('Your passport (and a second passport if you have two)', 'Ihren Reisepass (und einen zweiten Reisepass, falls Sie zwei haben)'),
  startNeedEid: t('Your Emirates ID, if you live in the UAE', 'Ihre Emirates ID, falls Sie in den VAE wohnen'),
  startNeedAddress: t(
    'A proof of address, for example a utility bill or a bank statement',
    'Einen Adressnachweis, zum Beispiel eine Nebenkostenabrechnung oder einen Kontoauszug'
  ),
  startNeedIncome: t('Details of your income', 'Angaben zu Ihren Einkünften'),
  startNeedPhoto: t('A recent passport size photo', 'Ein aktuelles Passfoto'),
  startTime: t('It takes about 15 minutes.', 'Dauer ca. 15 Minuten.'),
  startSaved: t(
    'Your answers are saved automatically. You can stop and come back later using the same link.',
    'Ihre Angaben werden automatisch gespeichert. Sie können jederzeit aufhören und später mit demselben Link weitermachen.'
  ),
  startButton: t('Start', 'Beginnen'),

  // Check your answers
  checkTitle: t('Check your answers', 'Angaben prüfen'),
  checkIntro: t(
    'Please check your answers before you submit. You can change any answer.',
    'Bitte prüfen Sie Ihre Angaben vor dem Absenden. Sie können jede Angabe noch ändern.'
  ),
  change: t('Change', 'Ändern'),
  notAnswered: t('Not answered', 'Nicht beantwortet'),
  missingAnswer: t('Missing', 'Fehlt'),
  noFile: t('No file uploaded', 'Keine Datei hochgeladen'),

  // After submit
  receivedTitle: t('We have received your form', 'Wir haben Ihr Formular erhalten'),
  receivedNext: t(
    'Our compliance team will check it and contact you if anything is missing.',
    'Unser Compliance-Team prüft es und meldet sich bei Ihnen, falls etwas fehlt.'
  ),
  yourAnswers: t('Your answers', 'Ihre Angaben'),
  retry: t('Try again', 'Erneut versuchen'),

  // Link pages
  invalidTitle: t('This link is not valid', 'Dieser Link ist ungültig'),
  invalidBody: t(
    'Please use the link from your TME Services email, or contact TME Services.',
    'Bitte verwenden Sie den Link aus der E-Mail von TME Services oder wenden Sie sich an TME Services.'
  ),
  closedTitle: t('This link is no longer valid', 'Dieser Link ist nicht mehr gültig'),
  closedBody: t(
    'Please contact TME Services and we will send you a new link.',
    'Bitte wenden Sie sich an TME Services, wir senden Ihnen dann einen neuen Link.'
  ),
  errorTitle: t('The form could not be loaded', 'Das Formular konnte nicht geladen werden'),
  errorBody: t(
    'Please reload the page. If it still does not open, please contact TME Services.',
    'Bitte laden Sie die Seite neu. Wenn sie sich weiterhin nicht öffnet, wenden Sie sich bitte an TME Services.'
  ),
} satisfies Record<string, EkycText>;

/** Month names for the bilingual date picker ("January / Januar"). */
export const EKYC_MONTHS: readonly EkycText[] = [
  t('January', 'Januar'),
  t('February', 'Februar'),
  t('March', 'März'),
  t('April', 'April'),
  t('May', 'Mai'),
  t('June', 'Juni'),
  t('July', 'Juli'),
  t('August', 'August'),
  t('September', 'September'),
  t('October', 'Oktober'),
  t('November', 'November'),
  t('December', 'Dezember'),
];
