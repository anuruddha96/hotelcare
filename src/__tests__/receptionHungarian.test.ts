import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import '@/lib/pms-reception-translations';
import '@/lib/ntak-translations';
import '@/lib/pms-unified-reception-translations';
import '@/lib/workforce/translations';
import { getStaticTranslationBundle } from '@/hooks/useTranslation';

const root = resolve(process.cwd(), 'src');
const rel = (path: string) => relative(root, path).split(sep).join('/');
const roots = [
  ...['Reservations', 'ReservationDetail', 'Guests', 'GuestDetail', 'ReceptionHome', 'ReceptionReports'].map(name => 'pages/' + name + '.tsx'),
  'components/revenue/WelcomeBackOverlay.tsx',
  'components/assistant/AssistantLauncher.tsx',
  'components/assistant/MiraFloatingButton.tsx',
  'App.tsx',
];
const excludedNames = new Set([
  'UserManagementDialog', 'AccessRolesDialog', 'SettingsDialog', 'ProfileDialog',
  'PhotoAdjuster', 'ReportsDialog', 'RoomAssignmentSummary', 'DirtyLinenCartBadge',
  'HotelFilter', 'DateRangeFilter', 'BrowserLocationHelpDialog', 'ReasonSettingEditor',
]);

function excluded(path: string): boolean {
  const p = rel(path);
  const basename = p.split('/').pop()?.replace(/\.tsx?$/, '') ?? '';
  return p.startsWith('../') || p.startsWith('components/ui/')
    || p.startsWith('integrations/supabase/types')
    || /(^|\/)(__tests__|training|purchase-invoices|purchaseInvoices)(\/|$)/i.test(p)
    || /(?:\.test|\.spec)\.tsx?$/i.test(p)
    || /(?:translations|i18n).*\.tsx?$/i.test(basename + '.ts')
    || excludedNames.has(basename);
}

function resolveImport(file: string, specifier: string): string | undefined {
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2))
    : specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined;
  if (!base) return undefined;
  return [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]
    .find(p => /\.tsx?$/.test(p) && existsSync(p) && statSync(p).isFile());
}

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function receptionClosure(): Map<string, ts.SourceFile> {
  const visited = new Set<string>();
  const closure = new Map<string, ts.SourceFile>();
  const pending = roots.filter(p => p !== 'App.tsx').map(p => join(root, p));
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path) || excluded(path)) continue;
    visited.add(path);
    const sf = parse(path);
    if (/^(components|pages|hooks)\//.test(rel(path))) closure.set(path, sf);
    const visit = (node: ts.Node) => {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        const dependency = resolveImport(path, specifier);
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // Check App's own shell text without pulling every unrelated lazy route into scope.
  const app = join(root, 'App.tsx');
  closure.set(app, parse(app));
  return closure;
}

const identical = new Map<string, string>([
  ['NTAK', 'Authority abbreviation'], ['VIZA', 'Authority system name'], ['PMS', 'Industry abbreviation'],
  ['THF', 'Official module abbreviation'], ['CSV', 'File format'], ['PDF', 'File format'],
  ['XML', 'Technical data format'], ['HR', 'Department abbreviation'], ['Marketing', 'Established Hungarian loanword'],
  ['OK', 'Universal acknowledgement'], ['E-mail', 'Established Hungarian spelling'],
  ['ADR', 'Hotel metric abbreviation'], ['RevPAR', 'Hotel metric abbreviation'],
  ['VIP', 'Industry abbreviation'], ['MRZ', 'Machine-readable zone abbreviation'],
  ['No-show', 'Existing approved hotel terminology'],
  ['HotelCare', 'Product name'], ['Previo', 'Product name'], ['Channex', 'Product name'],
  ['Booking.com', 'Brand name'], ['Airbnb', 'Brand name'], ['Expedia', 'Brand name'],
  ['Agoda', 'Brand name'], ['Számlázz.hu', 'Brand name'], ['Mira', 'Product name'],
  ['OpenAI', 'Brand name'], ['PCI Booking', 'Provider name'], ['API', 'Technical abbreviation'],
]);
const literalAllow = new Map<string, string>([
  ...identical,
  ['(MRZ)', 'Document standard abbreviation'], ['NTAK / VIZA', 'Names of authorities'],
  ['HUF', 'ISO currency'], ['EUR', 'ISO currency'], ['USD', 'ISO currency'],
  ['HU', 'ISO country code'], ['MET', 'Weather data provider'], ['MET Norway · CC BY 4.0 ·', 'Required MET Norway licence credit'], ['CC BY 4.0', 'Required licence attribution'],
  ['FOGL_01', 'Official example booking identifier'],
  ['CN=', 'Certificate subject prefix'], ['-----BEGIN CERTIFICATE-----', 'PEM header'],
  ['-----BEGIN PRIVATE KEY-----', 'PEM header'], ['feldolgozasAzonosito:', 'Official XML field name'],
]);

function literalText(value: string): string | undefined {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!/[A-Za-z].*[A-Za-z]/.test(clean) || literalAllow.has(clean)) return undefined;
  if (/^(?:https?:\/\/|\/|\.\/|\.\.\/|@\/)/.test(clean)) return undefined;
  if (/^[a-zA-Z][\w-]*(?:\.[\w-]+)+$/.test(clean)) return undefined; // Translation key
  if (/^(?:(?:[A-Z]{3}|%|·|\/|—|–|€|Ft)\s*)+$/.test(clean)) return undefined; // ISO units and punctuation
  return clean;
}

function displayStrings(node: ts.Node | undefined, report: (node: ts.Node, text: string) => void): void {
  if (!node) return;
  if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
    const text = literalText(node.text);
    if (text) report(node, text);
  } else if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) {
    displayStrings(node.expression, report);
  } else if (ts.isConditionalExpression(node)) {
    displayStrings(node.whenTrue, report);
    displayStrings(node.whenFalse, report);
  } else if (ts.isBinaryExpression(node)) {
    if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      displayStrings(node.right, report);
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) displayStrings(node.left, report);
    }
  } else if (ts.isTemplateExpression(node)) {
    const parts = [node.head, ...node.templateSpans.map(span => span.literal)];
    for (const part of parts) {
      const text = literalText(part.text);
      if (text) report(part, text);
    }
    for (const span of node.templateSpans) displayStrings(span.expression, report);
  } else if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && ['title', 'description'].includes(prop.name.getText().replace(/['"]/g, ''))) {
        displayStrings(prop.initializer, report);
      }
    }
  }
}

const displayAttrs = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'tooltip', 'helperText', 'hint']);

describe('reception Hungarian translation guard', () => {
  it('contains no untranslated keys, hard-coded text or non-localized date formatting', () => {
    const en = getStaticTranslationBundle('en');
    const hu = getStaticTranslationBundle('hu');
    const issues: string[] = [];
    const closure = receptionClosure();
    expect(closure.size).toBeGreaterThan(6);

    for (const [path, sf] of closure) {
      const location = (node: ts.Node) => rel(path) + ':' + (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
      const report = (node: ts.Node, message: string) => issues.push(location(node) + ' ' + message);
      const raw = (node: ts.Node, text: string) => report(node, 'Hard-coded display text: ' + text);
      const dateFnsFormatNames = new Set<string>();
      for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const spec = statement.moduleSpecifier.text;
        if (spec === 'date-fns' && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const item of statement.importClause.namedBindings.elements) {
            if ((item.propertyName ?? item.name).text === 'format') dateFnsFormatNames.add(item.name.text);
          }
        } else if (spec === 'date-fns/format' && statement.importClause?.name) {
          dateFnsFormatNames.add(statement.importClause.name.text);
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) displayStrings(node, raw);
        if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) displayStrings(node.expression, raw);
        if (ts.isJsxAttribute(node) && displayAttrs.has(node.name.getText(sf))) displayStrings(node.initializer, raw);
        if (ts.isStringLiteralLike(node) && ['en-GB', 'en-US'].includes(node.text)) report(node, 'Hard-coded locale: ' + node.text);
        if (ts.isCallExpression(node)) {
          const expr = node.expression;
          if (ts.isIdentifier(expr) && expr.text === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
            const key = node.arguments[0].text;
            if (!hu[key] || hu[key] === key || (hu[key] === en[key] && !identical.has(hu[key]))) {
              report(node, 'Missing Hungarian translation: ' + key);
            }
          }
          if ((ts.isIdentifier(expr) && expr.text === 'toast') ||
            (ts.isPropertyAccessExpression(expr) && expr.expression.getText(sf) === 'toast' &&
              ['success', 'error', 'warning', 'info'].includes(expr.name.text))) {
            for (const arg of node.arguments) displayStrings(arg, raw);
          }
          if (ts.isPropertyAccessExpression(expr) && ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].includes(expr.name.text)
            && (!node.arguments.length || node.arguments[0].getText(sf) === 'undefined')) {
            report(node, 'Missing explicit UI locale: ' + expr.name.text);
          }
          if (ts.isIdentifier(expr) && dateFnsFormatNames.has(expr.text)) {
            const options = node.arguments[2];
            if (!options || !ts.isObjectLiteralExpression(options) ||
              !options.properties.some(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(sf) === 'locale')) {
              report(node, 'date-fns format without locale option');
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect([...new Set(issues)].sort(), 'Complete the reception localization rather than adding unapproved exceptions').toEqual([]);
  });
});
