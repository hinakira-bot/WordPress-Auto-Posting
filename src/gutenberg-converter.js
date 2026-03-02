import * as cheerio from 'cheerio';
import logger from './logger.js';

// ---------------------------------------------------------------------------
// Helper: extract inner HTML from a cheerio selection
// ---------------------------------------------------------------------------
function innerHtml($, sel) {
  return $(sel).html() || '';
}

// ---------------------------------------------------------------------------
// Helper: get trimmed text content of the first matching child, then remove it
// Returns { title, $ } where $ is the mutated cheerio instance
// ---------------------------------------------------------------------------
function extractTitle($container, $) {
  // Try first <p>, <strong>, <span>, <div> child, or bare text node
  const firstP = $container.children('p, strong, span, h3, h4, h5, h6').first();
  if (firstP.length) {
    const title = firstP.text().trim();
    firstP.remove();
    return title;
  }

  // Fall back to first text node
  const textNodes = $container.contents().filter(function () {
    return this.type === 'text' && $(this).text().trim().length > 0;
  });

  if (textNodes.length) {
    const title = $(textNodes[0]).text().trim();
    $(textNodes[0]).replaceWith('');
    return title;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Helper: convert inner HTML to Gutenberg block format
// Used for content inside wp:group, wp:loos/step-item, etc.
// ---------------------------------------------------------------------------
function convertInnerToGutenberg(html) {
  if (!html || !html.trim()) return '';

  const blocks = splitTopLevelElements(html);
  const result = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Already has Gutenberg comments — skip
    if (/<!--\s*wp:/.test(trimmed)) {
      result.push(trimmed);
      continue;
    }

    const tagMatch = trimmed.match(/^<(\w+)[\s>]/);
    if (!tagMatch) {
      // Plain text — skip whitespace-only
      if (trimmed.length > 0 && !/^\s+$/.test(trimmed)) {
        result.push(`<!-- wp:paragraph -->\n<p>${trimmed}</p>\n<!-- /wp:paragraph -->`);
      }
      continue;
    }

    const tag = tagMatch[1].toLowerCase();

    switch (tag) {
      case 'p':
        result.push(`<!-- wp:paragraph -->\n${trimmed}\n<!-- /wp:paragraph -->`);
        break;
      case 'h2':
        result.push(`<!-- wp:heading -->\n${trimmed}\n<!-- /wp:heading -->`);
        break;
      case 'h3':
        result.push(`<!-- wp:heading {"level":3} -->\n${trimmed}\n<!-- /wp:heading -->`);
        break;
      case 'h4':
        result.push(`<!-- wp:heading {"level":4} -->\n${trimmed}\n<!-- /wp:heading -->`);
        break;
      case 'ul': {
        const wrapped = wrapListForGutenberg(trimmed, false);
        result.push(wrapped);
        break;
      }
      case 'ol': {
        const wrapped = wrapListForGutenberg(trimmed, true);
        result.push(wrapped);
        break;
      }
      case 'blockquote':
        result.push(`<!-- wp:quote -->\n${trimmed}\n<!-- /wp:quote -->`);
        break;
      case 'figure':
        result.push(`<!-- wp:image -->\n${trimmed}\n<!-- /wp:image -->`);
        break;
      case 'table':
        result.push(`<!-- wp:table -->\n<figure class="wp-block-table">${trimmed}</figure>\n<!-- /wp:table -->`);
        break;
      default:
        result.push(trimmed);
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Helper: wrap a list (<ul>/<ol>) in proper Gutenberg format with list-item comments
// ---------------------------------------------------------------------------
function wrapListForGutenberg(listHtml, ordered = false) {
  const $ = cheerio.load(listHtml, { decodeEntities: false, xmlMode: false });
  const $list = $('ul, ol').first();

  if (!$list.length) return listHtml;

  // Add wp-block-list class
  if (!$list.hasClass('wp-block-list')) {
    $list.addClass('wp-block-list');
  }

  // Wrap each direct <li> child in wp:list-item comments
  const liItems = [];
  $list.children('li').each(function () {
    const liOuterHtml = $.html(this);
    liItems.push(`<!-- wp:list-item -->\n${liOuterHtml}\n<!-- /wp:list-item -->`);
  });

  // Reconstruct the list
  const tag = ordered ? 'ol' : 'ul';
  const classAttr = $list.attr('class') || 'wp-block-list';
  const innerContent = liItems.join('\n');
  const listOutput = `<${tag} class="${classAttr}">${innerContent}</${tag}>`;

  const blockComment = ordered
    ? '<!-- wp:list {"ordered":true} -->'
    : '<!-- wp:list -->';

  return `${blockComment}\n${listOutput}\n<!-- /wp:list -->`;
}

// ---------------------------------------------------------------------------
// Conversion: point / note  ->  caption box (wp:html wrapping)
// ---------------------------------------------------------------------------
function convertCaptionBox($, el, style) {
  const $el = $(el);
  const title = extractTitle($el, $);
  const body = $el.html() || '';

  const className = style === 'note'
    ? 'swell-block-capbox is-style-caution_ttl'
    : 'swell-block-capbox is-style-onbdr_ttl2';

  const output = [
    `<div class="${className}">`,
    `  <div class="swell-block-capbox__title">${title}</div>`,
    `  <div class="swell-block-capbox__body">${body.trim()}</div>`,
    `</div>`,
  ].join('\n');

  $el.replaceWith(output);
}

// ---------------------------------------------------------------------------
// Conversion: check-list  ->  styled list in caption box (wp:html wrapping)
// ---------------------------------------------------------------------------
function convertCheckList($, el) {
  const $el = $(el);
  const $ul = $el.find('ul').first();

  // If there is no <ul>, wrap all content in one
  let items;
  if ($ul.length) {
    items = $ul.html() || '';
  } else {
    // Build list items from child elements or text
    const parts = [];
    $el.children().each(function () {
      parts.push(`<li>${$(this).html()}</li>`);
    });
    items = parts.join('\n');
  }

  const output = [
    `<div class="swell-block-capbox is-style-check_list">`,
    `  <div class="swell-block-capbox__body">`,
    `    <ul class="is-style-check_list">${items}</ul>`,
    `  </div>`,
    `</div>`,
  ].join('\n');

  $el.replaceWith(output);
}

// ---------------------------------------------------------------------------
// Conversion: step  ->  proper wp:loos/step block
// ---------------------------------------------------------------------------
function convertStepBlock($, el) {
  const $el = $(el);
  const stepItems = [];

  // Each direct child div / section / article is a step, or fall back to any children
  let children = $el.children('div, section, article');
  if (!children.length) {
    children = $el.children();
  }

  children.each(function () {
    const $child = $(this);
    const title = extractTitle($child, $);
    const bodyHtml = $child.html() || '';
    const innerBlocks = convertInnerToGutenberg(bodyHtml);

    stepItems.push([
      `<!-- wp:loos/step-item {"stepLabel":"STEP","numColor":"var(--color_deep02)"} -->`,
      `<div class="swell-block-step__item">`,
      `<div class="swell-block-step__number" style="background-color:var(--color_deep02)"><span class="__label">STEP</span></div>`,
      `<div class="swell-block-step__title u-fz-l">${title}</div>`,
      `<div class="swell-block-step__body">`,
      innerBlocks,
      `</div>`,
      `</div>`,
      `<!-- /wp:loos/step-item -->`,
    ].join('\n'));
  });

  // Handle case where there are no structural children — treat entire content as one step
  if (stepItems.length === 0) {
    const title = extractTitle($el, $);
    const bodyHtml = $el.html() || '';
    const innerBlocks = convertInnerToGutenberg(bodyHtml);
    stepItems.push([
      `<!-- wp:loos/step-item {"stepLabel":"STEP","numColor":"var(--color_deep02)"} -->`,
      `<div class="swell-block-step__item">`,
      `<div class="swell-block-step__number" style="background-color:var(--color_deep02)"><span class="__label">STEP</span></div>`,
      `<div class="swell-block-step__title u-fz-l">${title}</div>`,
      `<div class="swell-block-step__body">`,
      innerBlocks,
      `</div>`,
      `</div>`,
      `<!-- /wp:loos/step-item -->`,
    ].join('\n'));
  }

  const output = [
    `<!-- wp:loos/step -->`,
    `<div class="swell-block-step" data-num-style="circle">`,
    stepItems.join('\n'),
    `</div>`,
    `<!-- /wp:loos/step -->`,
  ].join('\n');

  $el.replaceWith(output);
}

// ---------------------------------------------------------------------------
// Conversion: faq  ->  FAQ block (wp:html wrapping)
// ---------------------------------------------------------------------------
function convertFaqBlock($, el) {
  const $el = $(el);
  const faqItems = [];

  // Strategy 1: look for explicit Q/A wrapper divs
  const qaDivs = $el.children('div, dl, section');
  if (qaDivs.length) {
    // If children are paired wrappers (each containing Q+A)
    let handledAsPairs = false;

    qaDivs.each(function () {
      const $child = $(this);

      // Check if this single div holds both Q and A
      const innerChildren = $child.children();
      if (innerChildren.length >= 2) {
        const q = $(innerChildren[0]).html() || $(innerChildren[0]).text();
        const a = $(innerChildren[1]).html() || $(innerChildren[1]).text();
        faqItems.push(buildFaqItem(q.trim(), a.trim()));
        handledAsPairs = true;
      }
    });

    // If we interpreted them as pairs, we're done
    if (handledAsPairs && faqItems.length > 0) {
      $el.replaceWith(wrapFaqBlock(faqItems));
      return;
    }
  }

  // Strategy 2: pair consecutive children as Q, A, Q, A ...
  const allChildren = $el.children();
  for (let i = 0; i < allChildren.length; i += 2) {
    const qEl = allChildren[i];
    const aEl = allChildren[i + 1];

    const q = qEl ? ($(qEl).html() || $(qEl).text()).trim() : '';
    const a = aEl ? ($(aEl).html() || $(aEl).text()).trim() : '';

    if (q) {
      faqItems.push(buildFaqItem(q, a));
    }
  }

  // Strategy 3: if still nothing, treat entire block as single Q with no A
  if (faqItems.length === 0) {
    const content = $el.html() || '';
    faqItems.push(buildFaqItem(content.trim(), ''));
  }

  $el.replaceWith(wrapFaqBlock(faqItems));
}

function buildFaqItem(question, answer) {
  return [
    `  <div class="swell-block-faq__item">`,
    `    <div class="swell-block-faq__q">${question}</div>`,
    `    <div class="swell-block-faq__a">${answer}</div>`,
    `  </div>`,
  ].join('\n');
}

function wrapFaqBlock(items) {
  return [
    `<div class="swell-block-faq">`,
    items.join('\n'),
    `</div>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Conversion: balloon  ->  proper wp:loos/balloon block
// ---------------------------------------------------------------------------
function convertBalloonBlock($, el, balloonID = '1') {
  const $el = $(el);

  // Grab the inner HTML; if it already contains <p>, keep it, otherwise wrap
  let bodyHtml = ($el.html() || '').trim();

  // If body is plain text (no block-level tags), wrap in <p>
  if (!/<(?:p|div|ul|ol|blockquote|h[1-6])\b/i.test(bodyHtml)) {
    bodyHtml = `<p>${bodyHtml}</p>`;
  }

  // wp:loos/balloon format — just the <p> content between comments
  const output = [
    `<!-- wp:loos/balloon {"balloonID":"${balloonID}"} -->`,
    bodyHtml,
    `<!-- /wp:loos/balloon -->`,
  ].join('\n');

  $el.replaceWith(output);
}

// ---------------------------------------------------------------------------
// Conversion: group box (border / background style)  ->  proper wp:group block
// ---------------------------------------------------------------------------
function convertGroupBox($, el, cssClass) {
  const $el = $(el);
  const body = $el.html() || '';

  // Convert inner content to proper Gutenberg blocks
  const innerBlocks = convertInnerToGutenberg(body);

  const output = [
    `<!-- wp:group {"className":"${cssClass}"} -->`,
    `<div class="wp-block-group ${cssClass}">`,
    innerBlocks,
    `</div>`,
    `<!-- /wp:group -->`,
  ].join('\n');

  $el.replaceWith(output);
}

// ---------------------------------------------------------------------------
// SWELL type -> { settingsKey, handler }
// Handlers that need settings receive them via closure in applySWELLDecorations
// ---------------------------------------------------------------------------
const SWELL_TYPES = {
  point: { settingsKey: 'captionBox', handler: ($, el, settings) => convertCaptionBox($, el, 'point') },
  note: { settingsKey: 'captionBox', handler: ($, el, settings) => convertCaptionBox($, el, 'note') },
  'check-list': { settingsKey: 'checkList', handler: ($, el, settings) => convertCheckList($, el) },
  step: { settingsKey: 'stepBlock', handler: ($, el, settings) => convertStepBlock($, el) },
  faq: { settingsKey: 'faqBlock', handler: ($, el, settings) => convertFaqBlock($, el) },
  balloon: {
    settingsKey: 'balloonBlock',
    handler: ($, el, settings) => {
      const balloonID = settings?.swell?.balloonID || '1';
      convertBalloonBlock($, el, balloonID);
    },
  },
  // ボーダー設定
  border: { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'has-border -border01') },
  'border-double': { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'has-border -border02') },
  'border-dashed': { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'has-border -border03') },
  'bg-color': { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'has-border -border04') },
  // スタイル（背景装飾）
  stripe: { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'is-style-bg_stripe') },
  grid: { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'is-style-bg_grid') },
  stitch: { settingsKey: 'groupStyle', handler: ($, el, settings) => convertGroupBox($, el, 'is-style-stitch') },
};

// ===========================================================================
// PUBLIC: applySWELLDecorations
// ===========================================================================
/**
 * Convert AI-generated `data-swell` marker divs into SWELL theme block markup.
 *
 * @param {string} html  - The source HTML containing data-swell attributes
 * @param {object} settings - Settings object; settings.swell controls behaviour
 * @returns {string} Transformed HTML
 */
export function applySWELLDecorations(html, settings = {}) {
  const swellSettings = settings.swell || {};

  // Global kill switch
  if (swellSettings.enabled === false) {
    logger.info('SWELL decorations disabled — returning HTML unchanged');
    return html;
  }

  if (!html || typeof html !== 'string') {
    logger.warn('applySWELLDecorations received empty or non-string input');
    return html || '';
  }

  try {
    const $ = cheerio.load(html, { decodeEntities: false, xmlMode: false });

    // Process each data-swell element
    $('[data-swell]').each(function () {
      const $el = $(this);
      const type = ($el.attr('data-swell') || '').trim().toLowerCase();

      if (!type) {
        logger.warn('Empty data-swell attribute found — skipping');
        return; // continue .each
      }

      const spec = SWELL_TYPES[type];
      if (!spec) {
        logger.warn(`Unknown data-swell type "${type}" — skipping`);
        return;
      }

      // Check per-block feature toggle
      if (swellSettings[spec.settingsKey] === false) {
        logger.info(`SWELL ${type} block disabled by settings — stripping marker only`);
        // Remove the data-swell attribute but leave content intact
        $el.removeAttr('data-swell');
        return;
      }

      // Pass settings to handler for balloon ID etc.
      spec.handler($, this, settings);
    });

    // cheerio.load wraps content in <html><head><body>, extract just the body
    return $('body').html() || '';
  } catch (err) {
    logger.error(`applySWELLDecorations failed: ${err.message}`);
    // Return original HTML on failure so we don't break the pipeline
    return html;
  }
}

// ===========================================================================
// PUBLIC: convertToGutenbergBlocks
// ===========================================================================

/**
 * Mapping of tag names (lowercase) to Gutenberg block wrappers.
 * Each entry: [openComment, closeComment]
 * Functions receive the matched tag and its full match for context.
 */
function gutenbergWrapFor(tag, fullMatch) {
  const t = tag.toLowerCase();

  switch (t) {
    case 'p':
      return ['<!-- wp:paragraph -->', '<!-- /wp:paragraph -->'];
    case 'h1':
      return ['<!-- wp:heading {"level":1} -->', '<!-- /wp:heading -->'];
    case 'h2':
      return ['<!-- wp:heading -->', '<!-- /wp:heading -->'];
    case 'h3':
      return ['<!-- wp:heading {"level":3} -->', '<!-- /wp:heading -->'];
    case 'h4':
      return ['<!-- wp:heading {"level":4} -->', '<!-- /wp:heading -->'];
    case 'h5':
      return ['<!-- wp:heading {"level":5} -->', '<!-- /wp:heading -->'];
    case 'h6':
      return ['<!-- wp:heading {"level":6} -->', '<!-- /wp:heading -->'];
    case 'ul':
      return ['<!-- wp:list -->', '<!-- /wp:list -->'];
    case 'ol':
      return ['<!-- wp:list {"ordered":true} -->', '<!-- /wp:list -->'];
    case 'blockquote':
      return ['<!-- wp:quote -->', '<!-- /wp:quote -->'];
    case 'figure': {
      // Detect wp-block-image or wp-block-table
      if (/wp-block-image/i.test(fullMatch)) {
        return ['<!-- wp:image -->', '<!-- /wp:image -->'];
      }
      if (/wp-block-table/i.test(fullMatch)) {
        return ['<!-- wp:table -->', '<!-- /wp:table -->'];
      }
      return ['<!-- wp:image -->', '<!-- /wp:image -->'];
    }
    case 'table':
      // Wrap in figure.wp-block-table before adding comment
      return ['<!-- wp:table -->', '<!-- /wp:table -->', true]; // true = needs figure wrapper
    case 'img':
      return ['<!-- wp:image -->', '<!-- /wp:image -->'];
    default:
      return null;
  }
}

/**
 * Wrap standard HTML elements in Gutenberg block comments.
 * Uses a regex/line-based approach to avoid cheerio mutating the markup.
 *
 * @param {string} html  - HTML with SWELL blocks already applied
 * @param {object} settings - Settings object
 * @returns {string} HTML with Gutenberg block comments
 */
export function convertToGutenbergBlocks(html, settings = {}) {
  const swellSettings = settings.swell || {};

  if (swellSettings.gutenbergBlocks === false) {
    logger.info('Gutenberg block wrapping disabled — returning HTML unchanged');
    return html;
  }

  if (!html || typeof html !== 'string') {
    logger.warn('convertToGutenbergBlocks received empty or non-string input');
    return html || '';
  }

  try {
    // Split into logical blocks. We need to handle multi-line elements,
    // so we parse top-level elements using a state machine approach.
    const blocks = splitTopLevelElements(html);
    const result = [];

    for (const block of blocks) {
      const trimmed = block.trim();

      if (!trimmed) {
        // Preserve blank lines
        result.push(block);
        continue;
      }

      // Already has Gutenberg comments (wp:group, wp:loos/balloon, wp:loos/step, etc.) — skip
      if (/<!--\s*wp:/.test(trimmed)) {
        result.push(block);
        continue;
      }

      // SWELL block div (capbox, faq, etc.) — wrap in wp:html
      if (/class\s*=\s*["'][^"']*swell-block-/i.test(trimmed)) {
        result.push(`<!-- wp:html -->\n${trimmed}\n<!-- /wp:html -->`);
        continue;
      }

      // Detect the opening tag
      const tagMatch = trimmed.match(/^<(\w+)[\s>]/);
      if (!tagMatch) {
        // Not an HTML element (plain text, comments, etc.) — leave as-is
        result.push(block);
        continue;
      }

      const tag = tagMatch[1].toLowerCase();

      // Lists need special handling: add wp-block-list class and wp:list-item comments
      if (tag === 'ul' || tag === 'ol') {
        const wrapped = wrapListForGutenberg(trimmed, tag === 'ol');
        result.push(wrapped);
        continue;
      }

      const wrap = gutenbergWrapFor(tag, trimmed);

      if (!wrap) {
        // Unrecognised tag (e.g. <div> without SWELL class) — wrap in wp:html
        if (tag === 'div') {
          result.push(`<!-- wp:html -->\n${trimmed}\n<!-- /wp:html -->`);
        } else {
          result.push(block);
        }
        continue;
      }

      const [open, close, needsFigure] = wrap;

      if (needsFigure && tag === 'table') {
        // Tables need to be wrapped in <figure class="wp-block-table">
        result.push(
          `${open}\n<figure class="wp-block-table">${trimmed}</figure>\n${close}`
        );
      } else if (tag === 'figure' && /wp-block-image/i.test(trimmed)) {
        // 図解画像: h2直下のため上余白なし + 画像下にスペーサー挿入
        result.push(`<!-- wp:image {"style":{"spacing":{"margin":{"top":"0","bottom":"0"}}}} -->\n${trimmed}\n<!-- /wp:image -->`);
        result.push(`<!-- wp:spacer {"height":"30px"} -->\n<div style="height:30px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`);
      } else {
        result.push(`${open}\n${trimmed}\n${close}`);
      }
    }

    return result.join('\n');
  } catch (err) {
    logger.error(`convertToGutenbergBlocks failed: ${err.message}`);
    return html;
  }
}

// ---------------------------------------------------------------------------
// Helper: split HTML string into an array of top-level element strings
// ---------------------------------------------------------------------------
/**
 * Splits an HTML string into top-level blocks, preserving multi-line elements.
 * Uses a simple tag-depth counter to detect when a top-level element closes.
 *
 * @param {string} html
 * @returns {string[]}
 */
function splitTopLevelElements(html) {
  const blocks = [];
  let current = '';
  let depth = 0;
  let inComment = false;
  let i = 0;

  while (i < html.length) {
    // ----- HTML comment handling -----
    if (html.startsWith('<!--', i)) {
      const endIdx = html.indexOf('-->', i + 4);
      if (endIdx === -1) {
        // Unclosed comment — consume rest
        current += html.slice(i);
        i = html.length;
      } else {
        const comment = html.slice(i, endIdx + 3);
        current += comment;
        i = endIdx + 3;
      }
      continue;
    }

    // ----- Self-closing or void tags -----
    if (html[i] === '<') {
      // Closing tag
      if (html[i + 1] === '/') {
        const closeEnd = html.indexOf('>', i);
        if (closeEnd === -1) {
          current += html.slice(i);
          i = html.length;
          continue;
        }
        const segment = html.slice(i, closeEnd + 1);
        current += segment;
        i = closeEnd + 1;
        depth--;

        if (depth <= 0) {
          depth = 0;
          blocks.push(current);
          current = '';
        }
        continue;
      }

      // Opening or self-closing tag
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        current += html.slice(i);
        i = html.length;
        continue;
      }

      const segment = html.slice(i, tagEnd + 1);
      current += segment;
      i = tagEnd + 1;

      // Extract tag name for void element check
      const nameMatch = segment.match(/^<(\w+)/);
      const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
      const voidTags = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
        'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
      ]);

      const isSelfClosing = /\/\s*>$/.test(segment);
      const isVoid = voidTags.has(tagName);

      if (isSelfClosing || isVoid) {
        if (depth === 0) {
          blocks.push(current);
          current = '';
        }
      } else {
        depth++;
      }
      continue;
    }

    // ----- Whitespace between top-level elements -----
    if (depth === 0 && /\s/.test(html[i])) {
      // Accumulate whitespace; if current is non-empty and is a completed block,
      // push it and start fresh
      if (current.trim()) {
        // This shouldn't happen if tags are balanced, but be safe
        // Keep accumulating
      }
      current += html[i];
      i++;
      continue;
    }

    // ----- Regular characters -----
    current += html[i];
    i++;
  }

  // Push any remaining content
  if (current.trim()) {
    blocks.push(current);
  }

  return blocks;
}
