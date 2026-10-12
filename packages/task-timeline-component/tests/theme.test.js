import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vendor = readFileSync(new URL('../vendor/timeline-component.js', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../src/clockoli-adapter.js', import.meta.url), 'utf8');
const template = vendor.match(/const TEMPLATE = `([\s\S]*?)`;/)[1];
const vendorStyle = template.match(/<style>([\s\S]*?)<\/style>/)[1];
const adapterStyle = adapter.match(/const CLOCKOLI_STYLE = `([\s\S]*?)`;/)[1];
const namedColors = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const hardColor = new RegExp(`#[\\da-f]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla)\\(|\\b(?:${namedColors.join('|')})\\b`, 'i');
const colorProperty = /^(?:--tt-(?:panel|text|muted|border|grid|grid-major|empty|shadow)|background(?:-[\w-]+)?|color|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|box-shadow)$/;

// A white continuation stripe sits on a task colour chip, independent of panel theme.
const themeNeutral = new Map([
  ['.calendar-task.segment-continuation::before', new Map([['background', 'rgba(255,255,255,.8)']])],
]);

function rules(css, context = '') {
  const result = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let start = 0;
  while (start < clean.length) {
    const open = clean.indexOf('{', start);
    if (open === -1) break;
    const heading = clean.slice(start, open).trim();
    let depth = 1;
    let end = open + 1;
    for (; depth > 0 && end < clean.length; end += 1) {
      if (clean[end] === '{') depth += 1;
      if (clean[end] === '}') depth -= 1;
    }
    assert.equal(depth, 0, `Unclosed CSS rule: ${heading}`);
    const body = clean.slice(open + 1, end - 1);
    if (heading.startsWith('@')) {
      result.push(...rules(body, heading.startsWith('@keyframes') ? heading : context));
    } else {
      const declarations = new Map(body.split(';').filter(value => value.trim()).map(value => {
        const colon = value.indexOf(':');
        assert.ok(colon > 0, `Malformed declaration: ${value}`);
        return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
      }));
      for (const selector of heading.split(',').map(value => value.trim())) {
        result.push({ selector: context ? `${context} ${selector}` : selector, declarations });
      }
    }
    start = end;
  }
  return result;
}

function themeFailures(css) {
  const overrides = rules(css);
  const failures = [];
  for (const { selector, declarations } of rules(vendorStyle)) {
    for (const [property, value] of declarations) {
      if (!colorProperty.test(property) || !hardColor.test(value)) continue;
      if (themeNeutral.get(selector)?.get(property) === value) continue;
      const properties = [property];
      if (property === 'background') properties.push('background-color');
      if (property === 'outline') properties.push('outline-color');
      if (property.startsWith('border')) properties.push(`${property}-color`, 'border', 'border-color');
      const baseClass = selector.match(/^(\.[\w-]+)(?:[.:][\w:().-]+)?$/)?.[1];
      const candidates = overrides.filter(rule => rule.selector === selector
        || (rule.selector === baseClass && properties.some(key => /!important\b/.test(rule.declarations.get(key)))));
      const themed = candidates.some(rule => {
        if (rule.declarations.get('display') === 'none') return true;
        return properties.some(key => {
          const replacement = rule.declarations.get(key);
          return replacement !== undefined && (/var\(--/.test(replacement) || /^(?:none|0)(?: !important)?$/.test(replacement));
        });
      });
      if (!themed) failures.push(`${selector}: ${property}: ${value}`);
    }
  }
  return failures;
}

function staleClasses(css) {
  const vendorClasses = new Set(rules(vendorStyle).flatMap(rule => [...rule.selector.matchAll(/\.([a-z][\w-]*)/gi)].map(match => match[1])));
  const createdClasses = [...adapter.matchAll(/\.className = '([^']+)'|\.classList\.(?:add|toggle|remove)\('([^']+)'/g)]
    .flatMap(match => (match[1] ?? match[2]).split(/\s+/));
  const known = new Set([...vendorClasses, ...createdClasses]);
  return [...new Set(rules(css).flatMap(rule => [...rule.selector.matchAll(/\.([a-z][\w-]*)/gi)].map(match => match[1])))].filter(name => !known.has(name));
}

test('Clockoli themes every hard-coded vendor TEMPLATE colour property', () => {
  assert.deepEqual(themeFailures(adapterStyle), []);
});

test('Clockoli theme selectors refer to vendor or adapter-created classes', () => {
  assert.deepEqual(staleClasses(adapterStyle), []);
});

test('theme coverage rejects a selector override that retains a fixed colour', () => {
  const incomplete = '.content { background: white; }';
  assert.ok(themeFailures(incomplete).includes('.content: background: #fff'));
  assert.deepEqual(staleClasses('.calendar-hour-label { background: var(--tt-panel); }'), ['calendar-hour-label']);
});
