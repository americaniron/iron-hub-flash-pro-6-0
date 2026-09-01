
import { QuoteItem, ClientInfo } from '../types.ts';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readSpreadsheetRows } from './spreadsheetService.ts';
import { PageModel, TextItem } from './parser/geometry.ts';
import { CoreItem, extractItems } from './parser/core.ts';
import { DocumentSummary, extractDocumentSummary } from './parser/documentSummary.ts';
import { selectAdapter } from './parser/adapters/index.ts';
import { describeEmptyResult, validateItems } from './parser/validate.ts';
import { Reconciliation, reconcileTotals } from './parser/reconcile.ts';

// --- Helper Functions ---

const deliveryMetadataPattern = /(?:\b\d{1,3}\s+)?(?:Atlanta|Waco(?:,\s*TX)?|St\.?\s*Augustine|Brooksville|Palm\s+Bay|Perry)(?:\s+(?:Atlanta|Waco(?:,\s*TX)?|St\.?\s*Augustine|Brooksville|Palm\s+Bay|Perry))*\s*\(\s*\d+\s*(?:-\s*\d*)?\s*(?:(?:business\s*)?days?)?\s*\)(?:\s*\(\s*\d+\s*(?:-\s*\d*)?\s*(?:business\s*)?days?\s*\))?/gi;

/**
 * Supplier fulfilment metadata that is NOT a Ring Power branch.
 *
 * deliveryMetadataPattern only recognises a fixed list of Ring Power branch names, so a quote
 * from any other supplier kept its availability column inside the part description — which is
 * how a piston pin came to be described as "59.975MM 6 CAT BACKORDER (6- ) DIAMETER PISTON PIN
 * 2 54 CAT BACKORDER CAT BACKORDER (6- ) (6- )".
 *
 * Matched as a source/stock phrase rather than a name list, so a new warehouse does not need a
 * code change to be stripped.
 */
const supplierStockMetadataPattern = /\b(?:CAT\s+)?(?:BACK\s?ORDER(?:ED)?|DROP\s?SHIP|SPECIAL\s+ORDER|NOT\s+STOCKED|NON\s?STOCK)\b/gi;

/**
 * A source name followed by its lead-time parenthetical — "CAT YORK CAT BACKORDER (5- )".
 *
 * This is the shape every supplier's availability column takes, whoever the warehouse is, so it
 * replaces the losing game of listing branch names one at a time. The trailing parenthetical is
 * required, which is what keeps it from eating an ordinary run of description words.
 */
const warehouseLeadTimePattern = /\b[A-Z][A-Z.'-]*(?:\s+[A-Z][A-Z.'-]*){0,3}\s*\(\s*\d*\s*-?\s*\d*\s*(?:business\s*)?(?:days?)?\s*\)/g;

/**
 * A lead-time parenthetical: "(6- )", "(5- 6)", "(3-5 days)", and the empty "( )" left behind
 * once its contents have been stripped. Only digits, dashes and an optional "days" ever appear
 * inside one, so this cannot swallow an engineering dimension such as "(M12 x 1.5)".
 */
const leadTimeParenPattern = /\(\s*\d*\s*-?\s*\d*\s*(?:business\s*)?(?:days?)?\s*\)/gi;

function normalizePdfText(text: string): string {
  return String(text || '')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\bS\s*T\s*A\s*T\s*U\s*S\s*:?/gi, 'STATUS:')
    .replace(/\bL\s*I\s*N\s*E\b/gi, 'LINE')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep engineering text while removing document metadata that leaked into a row. */
function cleanDescription(text: string): string {
  if (!text) return "";

  let cleaned = normalizePdfText(text)
    .replace(/\/\/parts\.cat\.com\/[^\s]*/gi, ' ')
    .replace(/https?:\/\/[^\s]*/gi, ' ')
    .replace(/\bhttps?\b|\blangid\s*=\s*[^\s]+|\b(?:SingleShipmentOrderSummaryView|storeId|catalogId)\S*/gi, ' ')
    .replace(deliveryMetadataPattern, ' ')
    .replace(warehouseLeadTimePattern, ' ')
    .replace(supplierStockMetadataPattern, ' ')
    .replace(leadTimeParenPattern, ' ')
    .replace(/^MM(?:\s+\d+){1,3}\s*/i, ' ')
    .replace(/^MM\s+GAGE\s*/i, ' ')
    .replace(/\bLINE\s+NOTE\b/gi, ' ')
    .replace(/\b(?:All\s+\d+\s+by\s+\w+\s+\d{1,2}|\d+\s+in\s+stock|in\s+stock|\d+\s+days?|contact\s+dealer|ship\s+\d{1,2}\/\d{2,4})\b/gi, ' ')
    .replace(/\b(?:Ring Power|RING POWER CORPORATION|Industrial Parts Depot|IPD|COSTEX|CTP|Costex Tractor Parts|Trak-Tek|Kelly Tractor|Pantropic|Thompson Tractor|Authorized Dealer|Sales Representative)\b/gi, ' ')
    .replace(/\b(?:Tampa|Riverview|Fern Hill|ADAM qadah|americanyellowiron\.com|cat\.com)\b/gi, ' ')
    .replace(/\b(?:10421 Fern Hill Dr\.?|813-671-3700|33578|United States|Florida|Orlando|Jacksonville|Fort Myers)\b/gi, ' ')
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, ' ')
    .replace(/\b(?:Unit Price|Extended Price|Total Price|Product Description|Availability|Notes|Quantity|Part Number|Warehouse|Loc|Ship|Ref|Code|Wgt|Weight|Lbs|Kgs)\b/gi, ' ')
    .replace(/\b(?:ORDER SUBTOTAL|ORDER TOTAL|SUBTOTAL|TAX|TOTAL DUE|SUMMARY OF CHARGES|GRAND TOTAL)\b/gi, ' ')
    .replace(/\(USD\)/gi, ' ')
    .replace(/[\|:]/g, ' ')
    .replace(/^(?:\d{1,3}\)\s*)+/, '')
    .replace(/^(?:\d{1,3}\.\s+)+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Stripping the availability column leaves its neighbouring numeric columns stranded at the
  // end of the description — "... CASTED VALVE GUIDE 2 50 2 27". Those trailing bare integers
  // are column bleed, never part of a part name. Only done when metadata was actually removed,
  // so a description that legitimately ends in a number is left alone.
  const removedMetadata = normalizePdfText(text) !== cleaned;
  if (removedMetadata) {
    cleaned = cleaned.replace(/(?:\s+\d{1,4}\b)+$/, '').trim();
  }

  return cleaned;
}

/**
 * Specifically removes summary-level text that can get mixed into line item descriptions.
 */
function cleanLineOfSummaryJunk(text: string): string {
  if (!text) return "";
  return normalizePdfText(text)
    // Remove specific summary keywords and everything after them on the line.
    .replace(/(?:SHIPPING\/MISCELLANEOUS|ORDER SUBTOTAL|ORDER TOTAL|HTTPS\?|LANGID=|STATUS:).*/i, '')
    .replace(deliveryMetadataPattern, ' ')
    .replace(supplierStockMetadataPattern, ' ')
    .replace(leadTimeParenPattern, ' ')
    // Also attempt to remove stray prices that might have been merged into the description
    .replace(/\s+\$\s?[\d,]+\.\d{2}\s*/, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extracts availability info from a line of text.
 */
function extractAvailability(text: string): { availability: string, remainingText: string } {
  const availPatterns = [
    /All\s+\d+\s+by\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i,
    /All\s+\d+\s+by\s+\d{1,2}\/\d{1,2}/i,
    /\d+\s+in\s+stock/i,
    /\bIn\s+Stock\b/i,
    /\b\d+\s+Days\b/i,
    /\d+\s+Contact\s+Dealer/i,
    /Contact\s+Dealer/i,
    /Ship\s+\d{1,2}\/\d{2,4}/i,
    /STATUS\s*:\s*\d+\s*(?:DAYS?|IN\s+STOCK)/i
  ];

  let availability = "";
  let remainingText = text;

  // The first match is the row's own availability column and is what the chip shows. But the
  // loop used to `break` there, leaving every OTHER availability fragment on the line sitting in
  // the text — which then became the part description. That is how a valve guide came to be
  // described as "... 2 50 CAT YORK CAT BACKORDER (5- ) (6- ) 2 27 CAT BACKORDER (6- )".
  // Keep the first, strip them all.
  for (const pat of availPatterns) {
    const global = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g");
    const m = remainingText.match(global);
    if (!m) continue;
    if (!availability) availability = m[0];
    remainingText = remainingText.replace(global, " ").replace(/\s{2,}/g, " ").trim();
  }

  return { availability, remainingText };
}

/**
 * Enhanced weight extraction with unit normalization.
 */
function extractWeight(text: string): { weight: number, remainingText: string } {
  if (!text) return { weight: 0, remainingText: text };
  const m = String(text).match(/(\.?\d+(?:\.\d+)?)\s*(lb|lbs|kg|kgs)\b/i);
  if (!m) {
    return { weight: 0, remainingText: text };
  }
  
  const val = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  const weightInLbs = (unit.includes("kg")) ? val * 2.20462 : val;
  const roundedWeight = Math.round(weightInLbs * 100) / 100;
  const remainingText = text.replace(m[0], " ").trim();
  
  return { weight: roundedWeight, remainingText };
}


function isDateString(str: string): boolean {
  return /^\d{1,2}[-\/]\d{2,4}$/.test(str) || /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(str);
}

// --- Specific Vendor Parsers ---

/**
 * Helper function to process a text line and add extracted data to the current item.
 * It modifies the item object directly.
 */
function processItemLine(item: QuoteItem, lineText: string): void {
  let text = normalizePdfText(lineText);
  if (!text) return;

  // 1. Extract Unit Price (more specific, so check first)
  const unitPriceMatch = text.match(/\$([0-9,]+\.[0-9]{2})\s*ea\./i);
  if (unitPriceMatch) {
    item.unitPrice = Math.round(parseFloat(unitPriceMatch[1].replace(/,/g, '')) * 100) / 100;
    text = text.replace(unitPriceMatch[0], '').trim();
  }

  // 2. Extract Total Price (if unit price wasn't already found from a total)
  const totalPriceMatch = text.match(/\$([0-9,]+\.[0-9]{2})\s*$/);
  if (totalPriceMatch && item.unitPrice === 0) {
    const totalPrice = parseFloat(totalPriceMatch[1].replace(/,/g, ''));
    if (item.qty > 0) {
        item.unitPrice = Math.round((totalPrice / item.qty) * 100) / 100;
    }
    text = text.replace(totalPriceMatch[0], '').trim();
  }

  // 3. Extract Notes
  const noteMatch = text.match(/Line item note:\s*(.*)/i);
  if (noteMatch) {
    item.notes = (item.notes ? item.notes + ' ' : '') + noteMatch[1].trim();
    text = text.replace(noteMatch[0], '').trim();
  }
  const replacesMatch = text.match(/Replaces Part #\s*\(([^)]+)\)/i);
  if (replacesMatch) {
    item.notes = (item.notes ? item.notes + ' ' : '') + `Replaces Part # (${replacesMatch[1]})`;
    text = text.replace(replacesMatch[0], '').trim();
  }
  if (text.toLowerCase().includes('non-returnable part')) {
    item.notes = (item.notes ? item.notes + ' ' : '') + 'Non-returnable part';
    text = text.replace(/non-returnable part/ig, '').trim();
  }
  if (text.toLowerCase().includes('remanufactured part')) {
    item.notes = (item.notes ? item.notes + ' ' : '') + 'Remanufactured part';
    text = text.replace(/remanufactured part/ig, '').trim();
  }
  
  // 4. Extract Availability
  //
  // A part's availability is ONE value — the availability column of its row. This appended every
  // match it found, and a row that wraps over four PDF text lines contributes a fragment from
  // each, which is how a chip came to read "25 IN STOCK 9 DAYS 139 DAYS CONTACT DEALER". The
  // first match is the row's own column; later ones are continuation lines and other warehouses.
  // Keep the first, and still strip the rest out of the text so they cannot fall into the
  // description instead.
  const availResult = extractAvailability(text);
  if (availResult.availability) {
    if (!item.availability) item.availability = availResult.availability;
    text = availResult.remainingText.trim();
  }

  // 5. Extract Weight
  const weightResult = extractWeight(text);
  if (weightResult.weight > 0) {
    item.weight = weightResult.weight;
    text = weightResult.remainingText.trim();
  }
  
  // 6. What's left is part of the description
  const cleanedText = cleanLineOfSummaryJunk(text);
  if (cleanedText && cleanedText.length > 1) {
    item.desc = (item.desc + ' ' + cleanedText).trim();
  }
}

/**
 * Ring Power specific line-item parser refined for accuracy and multi-line resilience.
 * Supports continuation flag for multi-page documents.
 */
/**
 * Ring Power line-oriented parser.
 *
 * Unexercised by every fixture in `fixtures/quotes` — but that is a statement about this disk,
 * not about production, and a real Ring Power quote would still reach it through the fallback
 * chain.  Kept and registered for that reason; see LEGACY_STRATEGIES.
 */
function parseRingPowerPage(textLines: {y: number, text: string}[], isContinuation: boolean = false): { items: QuoteItem[], yCoords: number[] } {
  const items: QuoteItem[] = [];
  const yCoords: number[] = [];
  
  let relevantLines = textLines;

  // If not a continuation, find the start of the items section to avoid header noise.
  if (!isContinuation) {
    const itemsHeaderIndex = textLines.findIndex(line => /Items In Your Order/i.test(line.text));
    if (itemsHeaderIndex !== -1) {
      relevantLines = textLines.slice(itemsHeaderIndex + 1);
    } else {
       // If header not found and not continuation, might not be a valid items page
       return { items, yCoords }; 
    }
  }

  // Regex to find the start of a new item line, e.g., "1)   1" or "3) 1"
  const itemStartRegex = /^\s*(\d+)\)\s+(\d+)\s+(.*)$/i;
  
  let currentItem: QuoteItem | null = null;
  let currentY = 0;
  let sawCoreDepositLabel = false; // Add state to track core deposit label
  let inNote = false;

  for (const lineObj of relevantLines) {
    const text = normalizePdfText(lineObj.text);
    
    // Check if we hit a summary or new section that indicates end of items
    if (/^(?:ORDER SUBTOTAL|ORDER TOTAL|SUMMARY OF CHARGES|PROMOTIONS(?:\s*&\s*OFFERS)?|BILLING METHOD|ORDER SUMMARY|PAYMENT METHOD|TERMS\b|SHIPPING\/MISCELLANEOUS)/i.test(text)) {
        break;
    }

    const startMatch = text.match(itemStartRegex);

    if (startMatch) {
      if (currentItem) {
        currentItem.desc = cleanDescription(currentItem.desc);
        items.push(currentItem);
        yCoords.push(currentY);
      }
      
      sawCoreDepositLabel = false; // Reset for new item
      inNote = false;
      const lineNo = startMatch[1];
      const qty = parseInt(startMatch[2], 10);
      let restOfLine = startMatch[3];
      
      const partNoMatch = restOfLine.match(/^([A-Z0-9\-]{4,20}:?)\s*/);
      
      if (!partNoMatch) {
         if (currentItem) processItemLine(currentItem, text);
        continue;
      }

      const partNo = partNoMatch[1].replace(/:$/, '');
      restOfLine = restOfLine.replace(partNoMatch[0], '').trim();

      currentItem = {
        lineNo, qty, partNo, desc: '', weight: 0, unitPrice: 0, coreDeposit: 0, availability: '', notes: '', originalImages: []
      };
      currentY = lineObj.y;
      
      processItemLine(currentItem, restOfLine);

    } else if (currentItem) {
      // This is a continuation line for the current item.
      if (sawCoreDepositLabel) {
        const coreValueMatch = text.match(/^\$?([0-9,]+\.[0-9]{2})$/);
        if (coreValueMatch) {
          currentItem.coreDeposit = parseFloat(coreValueMatch[1].replace(/,/g, ''));
          sawCoreDepositLabel = false; // Flag consumed
          continue; // Line is fully processed
        } else {
          sawCoreDepositLabel = false; // Not a value, reset flag and process line normally below
        }
      }

      // Check for "Core Deposit" and value on the same line
      const coreOnSameLineMatch = text.match(/Core Deposit\s*\$?([0-9,]+\.[0-9]{2})/i);
      if (coreOnSameLineMatch) {
          currentItem.coreDeposit = parseFloat(coreOnSameLineMatch[1].replace(/,/g, ''));
          const cleanedText = text.replace(coreOnSameLineMatch[0], '');
          processItemLine(currentItem, cleanedText); // Process rest of the line
          continue;
      }
      
      // Check for just the "Core Deposit" label on its own line
      if (text.trim().toLowerCase() === 'core deposit') {
          sawCoreDepositLabel = true;
          continue; // Line is consumed, wait for value on next line
      }

      if (text.trim().toLowerCase().startsWith('line item note:')) {
          inNote = true;
          const noteText = text.replace(/line item note:/i, '').trim();
          if (noteText) {
              currentItem.notes = (currentItem.notes ? currentItem.notes + ' ' : '') + noteText;
          }
          continue;
      }

      if (inNote) {
          // Check if this line looks like availability or price, which means note ended
          const availResult = extractAvailability(text);
          const priceMatch = text.match(/\$([0-9,]+\.[0-9]{2})/);
          if (availResult.availability || priceMatch) {
              inNote = false;
              processItemLine(currentItem, text);
          } else {
              currentItem.notes = (currentItem.notes ? currentItem.notes + ' ' : '') + text.trim();
              continue;
          }
      } else {
          processItemLine(currentItem, text);
      }
    }
  }
  
  if (currentItem) {
    currentItem.desc = cleanDescription(currentItem.desc);
    items.push(currentItem);
    yCoords.push(currentY);
  }
  
  return { items, yCoords };
}


/**
 * John Deere / Dobbs Equipment line-item parser.
 *
 * Unexercised by the fixtures on this disk, kept for the same reason as parseRingPowerPage: a
 * real Dobbs quote from a customer would still land here.
 */
function parseJohnDeerePage(textLines: {y: number, text: string, x?: number}[]): { items: QuoteItem[], yCoords: number[] } {
  const items: QuoteItem[] = [];
  const yCoords: number[] = [];
  
  // Extract all potential prices, quantities, and part numbers with their Y coords
  const parts: {y: number, partNo: string, desc: string}[] = [];
  const prices: {y: number, val: number, isEach: boolean}[] = [];
  const quantities: {y: number, val: number}[] = [];

  for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i];
      const text = line.text;
      
      // Ignore summary lines so we don't extract order totals as item prices
      // Be careful not to match "Part Number" or actual items
      const isSummaryLine = /^(order\s+)?subtotal|^(order\s+)?total|^estimate taxes|^shipping/i.test(text.trim());
      
      if (!isSummaryLine) {
          const eachRegex = /each\s*\$\s*([0-9,]+\.[0-9]{2})/gi;
          let match;
          while ((match = eachRegex.exec(text)) !== null) {
              prices.push({y: line.y, val: parseFloat(match[1].replace(/,/g, '')), isEach: true});
          }
          
          const priceRegex = /\$\s*([0-9,]+\.[0-9]{2})/g;
          while ((match = priceRegex.exec(text)) !== null) {
              // Check if "each" was already matched on this line to avoid double counting
              if (!text.toLowerCase().includes('each')) {
                prices.push({y: line.y, val: parseFloat(match[1].replace(/,/g, '')), isEach: false});
              }
          }
      }
      
      const qtyMatch1 = text.match(/-\s*(\d+)\s*\+/);
      if (qtyMatch1) {
          quantities.push({y: line.y, val: parseInt(qtyMatch1[1], 10)});
      } else if (/^\s*\d+\s*$/.test(text)) {
          quantities.push({y: line.y, val: parseInt(text.trim(), 10)});
      } else {
          const addMatch = text.match(/(?:^|\s)(\d+)\s*Add to My Lists/i);
          if (addMatch) {
              quantities.push({y: line.y, val: parseInt(addMatch[1], 10)});
          }
      }
      
      const partMatch = text.match(/Part\s*Number\s*:\s*([A-Z0-9\-]+)/i);
      if (partMatch) {
          // Reconstruct description from preceding lines
          let descLines = [];
          for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
              const t = textLines[j].text;
              if (/(Part\s*Number|Add to My Lists|Remove|Ship To Me|Pick Up|business hours|Dobbs Equipment|Cart ID:|Shopping Cart|Order Summary)/i.test(t) || /^\s*\d+\s*$/.test(t) || /^\s*\$\s*\d+(,\d+)*\.\d{2}\s*$/.test(t)) {
                  break;
              }
              descLines.unshift(t);
          }
          let desc = descLines.join(" ").replace(/\$\s*([0-9,]+\.[0-9]{2})/g, "").trim();
          const partPrefixRegex = new RegExp(`^${partMatch[1]}[:\\s]*`, 'i');
          desc = desc.replace(partPrefixRegex, '').trim();
          
          parts.push({y: line.y, partNo: partMatch[1], desc});
      }
  }
  
  // Sort parts by Y descending (top to bottom of page)
  parts.sort((a, b) => b.y - a.y);
  
  // Now match them up using Y-coordinate bounding boxes
  for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      // The next part is below this one, so its Y is smaller.
      // We use a generous window because JD item blocks are tall.
      const nextPartY = i < parts.length - 1 ? parts[i+1].y : -Infinity;
      
      // JD prices are often ABOVE the "Part Number" line in the text flow but physically near it.
      // Quantities are usually BELOW the "Part Number" line.
      const lowerBound = Math.max(nextPartY + 10, part.y - 350); 
      const upperBound = part.y + 150;
      
      // Find prices and quantities that fall within this item's vertical space
      const partPrices = prices.filter(p => p.y <= upperBound && p.y > lowerBound);
      const partQuantities = quantities.filter(q => q.y <= upperBound && q.y > lowerBound);
      
      let unitPrice = 0;
      let qty = 1;
      
      if (partQuantities.length > 0) {
          // Sort by proximity to the part number line
          partQuantities.sort((a, b) => Math.abs(a.y - part.y) - Math.abs(b.y - part.y));
          qty = partQuantities[0].val;
      }
      
      let totalPrice = 0;
      let foundEach = false;
      
      if (partPrices.length > 0) {
          const eachPrice = partPrices.find(p => p.isEach);
          if (eachPrice) {
              unitPrice = eachPrice.val;
              foundEach = true;
          } else {
              // If multiple prices and no "each", the one closest to the part number Y is likely the total
              partPrices.sort((a, b) => Math.abs(a.y - part.y) - Math.abs(b.y - part.y));
              totalPrice = partPrices[0].val;
          }
      }
      
      if (!foundEach && totalPrice > 0) {
          unitPrice = totalPrice / qty;
      } else if (!foundEach && unitPrice === 0) {
          unitPrice = totalPrice;
      }
      
      items.push({
          qty,
          partNo: part.partNo,
          desc: cleanDescription(part.desc),
          weight: 0,
          unitPrice: Math.round(unitPrice * 100) / 100,
          coreDeposit: 0,
          availability: '',
          originalImages: []
      });
      yCoords.push(part.y);
  }
  
  return { items, yCoords };
}

/**
 * Fallback parser for generic quotes.
 */
function parseFallback(textLines: {y: number, text: string}[]): { items: QuoteItem[], yCoords: number[] } {
  const items: QuoteItem[] = [];
  const yCoords: number[] = [];
  
  const genericPattern = /^\s*(\d{1,5})\s+([A-Z0-9\-]{4,20})\b\s*(.+?)(\d+\.\d{2})?$/i;

  for (const lineObj of textLines) {
    const text = lineObj.text;
    const m = text.match(genericPattern);

    if (m && !isDateString(m[2])) {
      const qty = parseInt(m[1]);
      items.push({
        qty,
        partNo: m[2],
        desc: cleanDescription(m[3]),
        weight: extractWeight(text).weight,
        unitPrice: m[4] ? parseFloat(m[4]) : 0,
        coreDeposit: 0,
        originalImages: []
      });
      yCoords.push(lineObj.y);
    }
  }
  return { items, yCoords };
}

/**
 * Final heuristic parser to catch items in non-standard layouts.
 */
function parseFuzzy(textLines: {y: number, text: string}[]): { items: QuoteItem[], yCoords: number[] } {
  const items: QuoteItem[] = [];
  const yCoords: number[] = [];

  for (const line of textLines) {
    const parts = line.text.split(/\s{2,}/); 
    if (parts.length < 2) continue;

    // Detect part number: 7 digits or a dash-separated alphanumeric string
    const partIdx = parts.findIndex(p => /^\d{7}$/.test(p) || /^[A-Z0-9]{2,3}-[A-Z0-9]{4,7}$/.test(p));
    if (partIdx !== -1) {
      const partNo = parts[partIdx];
      // Search for quantity nearby
      const qtyIdx = [partIdx - 1, partIdx + 1].find(idx => parts[idx] && /^\d+$/.test(parts[idx]));
      const qty = qtyIdx !== undefined ? parseInt(parts[qtyIdx]) : 1;
      const desc = parts.filter((_, i) => i !== partIdx && i !== qtyIdx).join(" ");

      items.push({
        qty,
        partNo,
        desc: cleanDescription(desc),
        weight: extractWeight(line.text).weight,
        unitPrice: 0,
        coreDeposit: 0,
        originalImages: []
      });
      yCoords.push(line.y);
    }
  }
  return { items, yCoords };
}

function extractClientInfo(textLines: {y: number, text: string}[]): Partial<ClientInfo> {
    const client: Partial<ClientInfo> = {};
    const fullText = textLines.map(l => l.text).join('\n');
    
    // Account Number & Company
    const accMatch = fullText.match(/Account Number\s*([0-9\-]+)\s*-\s*(.*)/i);
    if (accMatch) {
        client.accountNumber = accMatch[1].trim();
        client.company = accMatch[2].trim();
    }

    // Ordered By section
    const orderedByMatch = fullText.match(/Ordered By\s*([\s\S]*?)\s*(Pickup|Payment|Billing|Information)/i);
    if(orderedByMatch) {
        const orderedByBlock = orderedByMatch[1];
        const lines = orderedByBlock.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) client.contactName = lines[0];
        const emailMatch = orderedByBlock.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        if (emailMatch) client.email = emailMatch[0];
        const phoneMatch = orderedByBlock.match(/\+?\d[\d\s\-()]{8,}/);
        if (phoneMatch) client.phone = phoneMatch[0].trim();
    }
    
    // Improved address parsing helper
    const parseAddressBlock = (block: string): Partial<ClientInfo> => {
        const addr: Partial<ClientInfo> = {};
        const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
        
        // Find line with city/state/zip pattern
        const cityPattern = /([^,]+),\s*([A-Za-z\s]+)\s*(\d{5})/;
        let cityLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(cityPattern);
            if (match) {
                addr.billingCity = match[1].trim();
                addr.billingState = match[2].trim();
                addr.billingZip = match[3].trim();
                cityLineIndex = i;
                break;
            }
        }

        if (cityLineIndex > 0) {
            // Address is typically the line(s) before city
            addr.billingAddress = lines.slice(Math.max(0, cityLineIndex - 1), cityLineIndex).join(', ');
        } else if (lines.length > 1) {
            addr.billingAddress = lines[1];
        }
        return addr;
    };

    // Billing Address
    const billingMatch = fullText.match(/Billing Address\s*([\s\S]*?)\s*(SUMMARY|ORDER|PROMOTIONS|PAYMENT)/i);
    if (billingMatch) {
        const addrData = parseAddressBlock(billingMatch[1]);
        Object.assign(client, addrData);
    }

    // Pickup Location as Shipping Address
    const pickupMatch = fullText.match(/Pickup Location\s*([\s\S]*?)\s*(PROMOTIONS|SUMMARY|ITEMS)/i);
     if (pickupMatch) {
        const addrData = parseAddressBlock(pickupMatch[1]);
        client.shippingAddress = addrData.billingAddress;
        client.shippingCity = addrData.billingCity;
        client.shippingState = addrData.billingState;
        client.shippingZip = addrData.billingZip;
    }
    
    return client;
}

// --- Main Entry Points ---

interface RawTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Legacy coordinate-assisted table parser.
 *
 * NOT deprecated and NOT dead: it is still registered as a fallback because no fixture on this
 * disk proves what production sends.  It is, however, known to produce false positives, and the
 * evidence is specific — run against `fixtures/quotes/cat-partscatcom-boyd-2026-08.pdf` it
 * returns six "items" (ONLINE25, a promotion blurb, Payment Information, BILLING METHOD,
 * Billing Address, SUMMARY OF CHARGES), and against the round-trip quote it returns seven, of
 * which the part numbers are weights.  Both are asserted in test/parser-fixtures.test.mjs.
 *
 * Two things now contain that: the geometry core runs first and wins any disagreement, and
 * whatever this returns still has to pass `validateItems` before it can reach a QuoteItem.
 * It requires the literal token "part" in the header row, which is why it found nothing at all
 * on the Parts.Cat.Com layout — that header reads Item / Quantity / Product Description.
 */
function parseTableBasedPage(rawItems: RawTextItem[]): { items: QuoteItem[], yCoords: number[] } {
  const items: QuoteItem[] = [];
  const yCoords: number[] = [];

  const yGroups = new Map<number, RawTextItem[]>();
  for (const item of rawItems) {
    let matchY = -1;
    for (const y of yGroups.keys()) {
      if (Math.abs(y - item.y) <= 5) { matchY = y; break; }
    }
    if (matchY === -1) { matchY = item.y; yGroups.set(matchY, []); }
    yGroups.get(matchY)!.push(item);
  }

  let headerY = -1;
  let partX = -1, descX = -1, qtyX = -1, priceX = -1, totalX = -1;

  const sortedYs = Array.from(yGroups.keys()).sort((a, b) => b - a);

  for (const y of sortedYs) {
    const group = yGroups.get(y)!;
    const text = group.map(g => g.text.toLowerCase()).join(' ');
    if (text.includes('part') && (text.includes('qty') || text.includes('quantity') || text.includes('order') || text.includes('desc'))) {
      headerY = y;
      for (const g of group) {
        const t = g.text.toLowerCase();
        if (t.includes('part number') || t === 'part' || t === 'part no' || t === 'part #') partX = g.x;
        else if (t.includes('desc')) descX = g.x;
        else if (t.includes('qty') || t.includes('order')) {
            if (qtyX === -1) qtyX = g.x;
        }
        else if (t.includes('net price') || t.includes('unit price') || (t.includes('price') && priceX === -1)) priceX = g.x;
        else if (t.includes('total')) totalX = g.x;
      }
      // If we didn't find an exact match for partX, fallback to just 'part'
      if (partX === -1) {
        for (const g of group) {
          if (g.text.toLowerCase().includes('part')) partX = g.x;
        }
      }
      break;
    }
  }

  if (headerY === -1 || partX === -1) return { items, yCoords };

  let footerY = -Infinity;
  for (const y of sortedYs) {
    if (y >= headerY - 10) continue;
    const group = yGroups.get(y)!;
    const text = group.map(g => g.text.toLowerCase()).join(' ');
    if (text.match(/subtotal|total approximate|comments:|prodn\.|freight|not allowed|costex reserves|fee for cancellation|terms:|warranty/i)) {
      footerY = y;
      break;
    }
  }

  const partItems = rawItems.filter(item => 
    item.y < headerY - 10 && 
    item.y > footerY + 10 &&
    Math.abs(item.x - partX) < 20 && 
    item.text.trim().length >= 4 &&
    !item.text.toLowerCase().includes('part')
  );

  partItems.sort((a, b) => b.y - a.y);

  for (let i = 0; i < partItems.length; i++) {
    const partItem = partItems[i];
    const nextPartY = i < partItems.length - 1 ? partItems[i+1].y : footerY;

    const rowItems = rawItems.filter(item => item.y <= partItem.y + 10 && item.y > nextPartY + 10);

    let desc = '';
    let qty = 1;
    let unitPrice = 0;
    let totalPrice = 0;
    let qtyFound = false;

    rowItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 5) return b.y - a.y;
      return a.x - b.x;
    });

    for (const item of rowItems) {
      if (item === partItem) continue;

      const distToDesc = descX !== -1 ? Math.abs(item.x - descX) : Infinity;
      const distToQty = qtyX !== -1 ? Math.abs(item.x - qtyX) : Infinity;
      const distToPrice = priceX !== -1 ? Math.abs(item.x - priceX) : Infinity;
      const distToTotal = totalX !== -1 ? Math.abs(item.x - totalX) : Infinity;

      const minDist = Math.min(distToDesc, distToQty, distToPrice, distToTotal);

      if (minDist === distToDesc || (descX !== -1 && item.x >= descX - 20 && item.x < (qtyX !== -1 ? qtyX - 20 : Infinity))) {
        desc += item.text + ' ';
      } else if (minDist === distToQty && minDist < 50) {
        const q = parseInt(item.text.replace(/,/g, ''));
        if (!isNaN(q) && !qtyFound) { qty = q; qtyFound = true; }
      } else if (minDist === distToPrice && minDist < 50) {
        const p = parseFloat(item.text.replace(/[^0-9.]/g, ''));
        if (!isNaN(p)) unitPrice = p;
      } else if (minDist === distToTotal && minDist < 50) {
        const p = parseFloat(item.text.replace(/[^0-9.]/g, ''));
        if (!isNaN(p)) totalPrice = p;
      }
    }

    if (unitPrice === 0 && totalPrice > 0 && qty > 0) {
      unitPrice = totalPrice / qty;
    }

    items.push({
      qty,
      partNo: partItem.text.trim(),
      desc: cleanDescription(desc.trim()),
      weight: 0,
      unitPrice: Math.round(unitPrice * 100) / 100,
      coreDeposit: 0,
      originalImages: []
    });
    yCoords.push(partItem.y);
  }

  return { items, yCoords };
}

/** What a paste or spreadsheet import produced, plus anything the guard had to say about it. */
export interface ItemParseResult {
  items: QuoteItem[];
  warnings: string[];
}

/**
 * Parse pasted quote text.
 *
 * Runs the same legacy strategies as before — but its output now goes through the same
 * part-number validation as the PDF path. It had none, which meant the exact strategies that
 * returned "25 LBS" and "SUMMARY OF CHARGES" as part numbers on a PDF could still do it here.
 * Pasted text is inferred, not declared, so the family requirement applies in full.
 */
export const parseTextData = (text: string): ItemParseResult => {
  const lines = text.split('\n').map((l, i) => ({ y: i * 20, text: l }));
  let result = parseRingPowerPage(lines);
  if (result.items.length === 0) result = parseFallback(lines);
  if (result.items.length === 0) result = parseFuzzy(lines);

  const validated = validateItems(result.items, { requireFamilyMatch: true });
  if (!validated.accepted.length && validated.rejected.length) {
    throw new Error(
      `None of the ${validated.rejected.length} candidate line item(s) carried a recognisable part number: ` +
        validated.rejected.slice(0, 5).map((r) => `"${r.value}" (${r.reason})`).join(', ') +
        '. Check that the pasted text includes part numbers.',
    );
  }
  return { items: validated.accepted, warnings: validated.warnings };
};

/**
 * Parse a CSV or spreadsheet.
 *
 * The part number here is declared — the user put it in a column named for it — so the family
 * requirement is relaxed and a mismatch is reported rather than dropped, which keeps aftermarket
 * SKUs importable. The shape vetoes still apply, so a weight or a currency value in that column
 * is still refused.
 */
export const parseExcelFile = async (file: File): Promise<ItemParseResult> => {
  const jsonData = await readSpreadsheetRows(file);
  const rows: QuoteItem[] = jsonData.map((row: any) => {
    const unitPrice = Number(row.unitPrice || row.Price || row['Unit Price'] || 0);
    const weight = Number(row.weight || row.Weight || 0);
    return {
      qty: Number(row.qty || row.Quantity || row.Qty || 1),
      partNo: String(row.partNo || row.Part || row.Item || row['Part Number'] || ""),
      desc: cleanDescription(String(row.desc || row.Description || "Part Description")),
      weight: Math.round(weight * 100) / 100,
      unitPrice: Math.round(unitPrice * 100) / 100,
      coreDeposit: 0,
      availability: String(row.availability || ""),
      originalImages: []
    };
  }).filter((item: QuoteItem) => item.partNo && item.partNo.length > 3 && !isDateString(item.partNo));

  const validated = validateItems(rows, { requireFamilyMatch: false });
  if (!validated.accepted.length && validated.rejected.length) {
    throw new Error(
      `None of the ${validated.rejected.length} row(s) carried a usable part number: ` +
        validated.rejected.slice(0, 5).map((r) => `"${r.value}" (${r.reason})`).join(', ') + '.',
    );
  }
  return { items: validated.accepted, warnings: validated.warnings };
};

// --- PDF entry point -----------------------------------------------------------------------

/**
 * Result of parsing a supplier PDF.
 *
 * `items` and `clientInfo` are unchanged from the previous contract, so the Intake Center and
 * everything downstream of it keep working untouched.  The rest is additive.
 */
export interface PdfParseResult {
  items: QuoteItem[];
  clientInfo: Partial<ClientInfo>;
  /** Order-level totals and header fields.  Totals are reported as printed, never recomputed. */
  summary: DocumentSummary;
  /**
   * Things a person should check before quoting: a total that does not reconcile, a redacted
   * price, a line with no part number.  This is what the Intake Center shows.
   */
  warnings: string[];
  /**
   * Engineering detail — which strategy produced the items and where the legacy strategies
   * disagreed.  Deliberately kept out of the UI: "Legacy strategy table-based found 6 items"
   * means nothing to a parts salesperson, and burying the reconciliation warnings in noise is
   * how a panel stops being read.
   */
  diagnostics: string[];
  /** Which strategy produced `items` — "geometry-core+caterpillar", "legacy:ring-power", ... */
  strategy: string;
  /** Line-item total checked against the printed subtotal and total.  Never auto-corrected. */
  reconciliation: Reconciliation;
}

/** A legacy strategy's output, with the anchor coordinates needed to pair images. */
interface LegacyResult {
  name: string;
  items: QuoteItem[];
  anchors: { pageNumber: number; y: number }[];
}

/** One page's worth of input for the legacy line-oriented strategies. */
interface LegacyPageInput {
  pageNumber: number;
  textLines: { y: number; text: string }[];
  rawItems: RawTextItem[];
  pageText: string;
}

/**
 * The pre-geometry strategies, kept and registered rather than replaced.
 *
 * None of them fires on any fixture in `fixtures/quotes`, but absence from this disk is not
 * absence from production: a Ring Power or Dobbs/Deere quote from a real customer would still
 * land on them, and deleting them would break that silently.  They now run only when the
 * geometry core comes up empty, and their output goes through the same part-number validation,
 * which is what stops them re-introducing the garbage they used to emit.
 */
interface LegacyStrategy {
  name: string;
  /** True when this strategy claims the document (brand sniffing, as before). */
  claims(input: LegacyPageInput, state: LegacyState): boolean;
  run(input: LegacyPageInput, state: LegacyState): { items: QuoteItem[]; yCoords: number[] };
}

interface LegacyState {
  isRingDocument: boolean;
  isJohnDeereDocument: boolean;
}

const LEGACY_STRATEGIES: LegacyStrategy[] = [
  {
    name: 'ring-power',
    claims: (_input, state) => state.isRingDocument,
    run: (input, _state) => parseRingPowerPage(input.textLines, input.pageNumber > 1),
  },
  {
    name: 'john-deere',
    claims: (_input, state) => state.isJohnDeereDocument,
    run: (input) => parseJohnDeerePage(input.textLines),
  },
  {
    name: 'table-based',
    claims: () => true,
    run: (input) => parseTableBasedPage(input.rawItems),
  },
  {
    name: 'fallback',
    claims: () => true,
    run: (input) => parseFallback(input.textLines),
  },
  {
    name: 'fuzzy',
    claims: () => true,
    run: (input) => parseFuzzy(input.textLines),
  },
];

/** Map a geometry-core item onto the QuoteItem contract, adding only optional fields. */
function toQuoteItem(item: CoreItem): QuoteItem {
  return {
    lineNo: item.lineNo,
    qty: item.qty,
    partNo: item.partNo,
    desc: item.desc,
    weight: item.weight,
    unitPrice: item.unitPrice,
    coreDeposit: item.coreDeposit,
    availability: item.availability,
    notes: item.notes,
    originalImages: [],
    extendedPrice: item.extendedPrice,
    currency: item.currency,
    leadTime: item.leadTime,
    warnings: item.warnings.length ? item.warnings : undefined,
    confidence: item.confidence,
    rawLines: item.rawLines,
  };
}

/**
 * Image extraction, unchanged in behaviour and moved into its own function so the page loop
 * stays readable.  Best effort throughout: a PDF whose images cannot be decoded must still
 * yield its line items.
 */
async function extractPageImages(
  page: any,
  pdfjs: any,
): Promise<{ y: number; x: number; dataUrl: string; width: number; height: number }[]> {
  const images: { y: number; x: number; dataUrl: string; width: number; height: number }[] = [];

  const resolvePageImage = (imageKey: string): Promise<any | null> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value: any) => {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      const timer = window.setTimeout(() => finish(null), 3_000);
      try {
        const callbackResult = page.objs.get(imageKey, (value: any) => {
          window.clearTimeout(timer);
          finish(value);
        });
        if (callbackResult && typeof callbackResult.then === 'function') {
          callbackResult
            .then((value: any) => {
              window.clearTimeout(timer);
              finish(value);
            })
            .catch(() => {
              window.clearTimeout(timer);
              finish(null);
            });
        } else if (callbackResult && typeof callbackResult === 'object') {
          window.clearTimeout(timer);
          finish(callbackResult);
        }
      } catch {
        window.clearTimeout(timer);
        finish(null);
      }
    });

  const processOperatorList = async (fnArray: any[], argsArray: any[], initialTransform: number[]) => {
    const transformStack: any[] = [];
    let currentTransform = [...initialTransform];

    for (let i = 0; i < fnArray.length; i++) {
      // Yield to the main thread periodically so a large PDF does not freeze the UI.
      if (i % 5000 === 0 && i > 0) await new Promise((r) => setTimeout(r, 0));

      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === pdfjs.OPS.save) {
        transformStack.push([...currentTransform]);
      } else if (fn === pdfjs.OPS.restore) {
        currentTransform = transformStack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === pdfjs.OPS.transform) {
        currentTransform = pdfjs.Util.transform(currentTransform, args);
      } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        try {
          let imgData: any = null;
          if (fn === pdfjs.OPS.paintImageXObject) {
            imgData = await resolvePageImage(args[0]);
          } else {
            imgData = args[0];
          }

          if (imgData) {
            const width = imgData.width || (imgData.bitmap && imgData.bitmap.width) || imgData.naturalWidth;
            const height = imgData.height || (imgData.bitmap && imgData.bitmap.height) || imgData.naturalHeight;
            if (!width || !height || width < 20 || height < 20) continue;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              if (imgData.bitmap) {
                ctx.drawImage(imgData.bitmap, 0, 0);
              } else if (imgData.data) {
                const imageData = ctx.createImageData(width, height);
                const data = imgData.data;
                const pixels = imageData.data;
                if (data.length === width * height * 3) {
                  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
                    pixels[q] = data[p];
                    pixels[q + 1] = data[p + 1];
                    pixels[q + 2] = data[p + 2];
                    pixels[q + 3] = 255;
                  }
                } else if (data.length === width * height * 4) {
                  pixels.set(data);
                } else if (data.length === width * height) {
                  for (let p = 0, q = 0; p < data.length; p++, q += 4) {
                    pixels[q] = pixels[q + 1] = pixels[q + 2] = data[p];
                    pixels[q + 3] = 255;
                  }
                }
                ctx.putImageData(imageData, 0, 0);
              } else if (
                imgData instanceof HTMLImageElement ||
                imgData instanceof HTMLCanvasElement ||
                imgData instanceof ImageBitmap
              ) {
                ctx.drawImage(imgData, 0, 0);
              }
              images.push({
                y: currentTransform[5],
                x: currentTransform[4],
                width,
                height,
                dataUrl: canvas.toDataURL('image/jpeg', 0.8),
              });
            }
          }
        } catch {
          // Text extraction still succeeds when a PDF image cannot be decoded.
        }
      }
    }
  };

  let imageExtractionTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const imageExtraction = (async () => {
      const operatorList = await page.getOperatorList();
      await processOperatorList(operatorList.fnArray, operatorList.argsArray, [1, 0, 0, 1, 0, 0]);
    })();
    const timeout = new Promise<never>((_, reject) => {
      imageExtractionTimeout = setTimeout(() => reject(new Error('PDF image extraction timed out.')), 20_000);
    });
    await Promise.race([imageExtraction, timeout]);
  } catch {
    // Image extraction is best effort and must not block quote extraction.
  } finally {
    if (imageExtractionTimeout) clearTimeout(imageExtractionTimeout);
  }

  return images;
}

/**
 * Parse a supplier PDF into line items.
 *
 * Order of operations: read every page's words with their coordinates, ask the geometry core for
 * items, and only if it finds none fall through to the legacy per-brand strategies.  Whatever
 * produces the items, they pass the same part-number validation before being returned, and if
 * nothing survives the caller gets a diagnosis naming the stage that came up short rather than
 * the old "No items detected in source."
 */
export const parsePdfFile = async (file: File): Promise<PdfParseResult> => {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('PDF files must be between 1 byte and 10 MB.');
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // The Suite proxy rewrites this emitted /assets URL into /hub-proxy/assets.
  // Keeping the client value untouched prevents a second proxy prefix after
  // Vite folds this imported URL into the production bundle.
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const arrayBuffer = await file.arrayBuffer();

  let pdf: any;
  try {
    pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  } catch (error: any) {
    const name = String(error?.name || '');
    if (/Password/i.test(name) || /password/i.test(String(error?.message || ''))) {
      throw new Error('This PDF is password protected. Remove the password and upload it again.');
    }
    throw new Error('This file could not be opened as a PDF. Confirm it is not corrupt, then retry.');
  }

  const warnings: string[] = [];
  const diagnostics: string[] = [];
  const pages: PageModel[] = [];
  const legacyPages: LegacyPageInput[] = [];
  const imagesByPage = new Map<number, { y: number; x: number; dataUrl: string; width: number; height: number }[]>();
  const legacyState: LegacyState = { isRingDocument: false, isJohnDeereDocument: false };

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    // Geometry model: coordinates preserved, normalised against the page box so Letter, A4 and
    // Legal all behave the same.
    const items: TextItem[] = [];
    for (const item of textContent.items as any[]) {
      if (typeof item?.str !== 'string') continue;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const fontSize = Math.hypot(transform[0], transform[1]) || item.height || 9;
      const baselineFromTop = viewport.height - transform[5];
      items.push({
        text: item.str,
        x0: transform[4],
        x1: transform[4] + (item.width || 0),
        top: baselineFromTop - (item.height || fontSize),
        bottom: baselineFromTop,
        fontSize,
        fontName: item.fontName,
      });
    }
    pages.push({ pageNumber: pageNum, width: viewport.width, height: viewport.height, items });

    // Legacy model: the flattened line view the pre-geometry strategies were written against.
    const linesMap = new Map<number, any[]>();
    (textContent.items as any[]).forEach((item: any) => {
      if (typeof item?.str !== 'string') return;
      const y = Math.round(item.transform[5]);
      let matchY: number | undefined;
      for (const key of linesMap.keys()) {
        if (Math.abs(key - y) <= 8) {
          matchY = key;
          break;
        }
      }
      if (matchY === undefined) {
        matchY = y;
        linesMap.set(matchY, []);
      }
      linesMap.get(matchY)!.push(item);
    });
    const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
    const textLines = sortedY
      .map((y) => ({
        y,
        text: linesMap
          .get(y)!
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((it) => it.str)
          .join(' ')
          .trim(),
      }))
      .filter((l) => l.text.length > 0);
    const rawItems: RawTextItem[] = (textContent.items as any[])
      .filter((item: any) => typeof item?.str === 'string')
      .map((item: any) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }))
      .filter((it: any) => it.text.trim().length > 0);
    const pageText = textLines.map((l) => l.text).join(' ');

    if (/Ring Power|RING POWER CORPORATION/i.test(pageText)) legacyState.isRingDocument = true;
    if (/John Deere|Dobbs Equipment/i.test(pageText)) legacyState.isJohnDeereDocument = true;

    legacyPages.push({ pageNumber: pageNum, textLines, rawItems, pageText });
    imagesByPage.set(pageNum, await extractPageImages(page, pdfjs));
  }

  const summary = extractDocumentSummary(pages);
  warnings.push(...summary.warnings);
  const clientInfo: Partial<ClientInfo> = legacyPages.length ? extractClientInfo(legacyPages[0].textLines) : {};

  const selection = selectAdapter(pages);
  const coreResult = extractItems(pages, selection.options);
  const coreValidated = validateItems(coreResult.items, {
    families: selection.options.families,
    allowBlankPartNumbers: true,
  });
  warnings.push(...coreValidated.warnings);

  let items: QuoteItem[] = coreValidated.accepted.map(toQuoteItem);
  let coreItems: CoreItem[] = coreValidated.accepted;
  // Bottom-origin PDF coordinates, the same space the operator list reports image positions in.
  // pageModel.height - item.anchorY is exactly transform[5], so this reproduces the coordinate
  // the previous parser matched on.
  let imageAnchors: { pageNumber: number; y: number }[] = coreValidated.accepted.map((item) => ({
    pageNumber: item.pageNumber,
    y: (pages.find((p) => p.pageNumber === item.pageNumber)?.height ?? 0) - item.anchorY,
  }));
  let strategy = items.length
    ? `geometry-core${selection.adapter && selection.adapter.name !== 'generic' ? `+${selection.adapter.name}` : ''}`
    : '';

  // Legacy strategies always run, but only to be compared against.  The core wins any
  // disagreement; the disagreement itself is recorded so a regression in either is visible.
  const legacyResults = runLegacyStrategies(legacyPages, legacyState);
  if (items.length) {
    for (const result of legacyResults) {
      if (result.items.length && result.items.length !== items.length) {
        diagnostics.push(
          `Legacy strategy "${result.name}" found ${result.items.length} item(s) where the layout engine found ${items.length}; the layout engine's result was used.`,
        );
      }
    }
  } else {
    for (const result of legacyResults) {
      const validated = validateItems(result.items, { families: selection.options.families });
      warnings.push(...validated.warnings);
      if (validated.accepted.length) {
        // Map surviving items back to their anchors: validation may have dropped some, so the
        // index into `result.items` is what lines an item up with its coordinate.
        imageAnchors = validated.accepted
          .map((item) => result.items.indexOf(item as QuoteItem))
          .map((index, position) => result.anchors[index] ?? result.anchors[position] ?? { pageNumber: 1, y: 0 });
        items = validated.accepted;
        coreItems = [];
        strategy = `legacy:${result.name}`;
        diagnostics.push(`The layout engine found no items; fell back to the legacy "${result.name}" strategy.`);
        break;
      }
    }
  }

  if (!items.length) {
    const failure = coreResult.failure;
    const detail = failure?.message ?? 'No line items could be read from this document.';
    const rejected = [...coreResult.rejected, ...coreValidated.rejected];
    const rejectedNote = rejected.length
      ? ` ${rejected.length} candidate(s) were rejected: ${rejected
          .slice(0, 5)
          .map((r) => `"${r.value}" (${r.reason})`)
          .join(', ')}.`
      : '';
    throw new Error(
      describeEmptyResult(failure?.kind ?? 'no-header', detail + rejectedNote, failure?.textPreview ?? ''),
    );
  }

  // Pair each item with the nearest image on its own page.  Coordinates from the operator list
  // are bottom-origin, so the anchor is converted back before comparing.
  for (let index = 0; index < items.length; index++) {
    const anchor = imageAnchors[index];
    if (!anchor) continue;
    const available = imagesByPage.get(anchor.pageNumber);
    if (!available || !available.length) continue;
    let bestIndex = -1;
    let minDiff = Infinity;
    available.forEach((image, i) => {
      const diff = Math.abs(image.y - anchor.y);
      // Keep logos and footer art away from parts by requiring a nearby row.
      if (diff < minDiff && diff < 300) {
        minDiff = diff;
        bestIndex = i;
      }
    });
    if (bestIndex !== -1) {
      items[index] = { ...items[index], originalImages: [available[bestIndex].dataUrl] };
      available.splice(bestIndex, 1);
    }
  }

  // Cross-check the arithmetic last, once the final item set is known whichever strategy
  // produced it.  A disagreement is reported, never resolved by adjusting a figure.
  const reconciliation = reconcileTotals(coreItems.length ? coreItems : [], summary);
  if (coreItems.length) {
    for (const warning of reconciliation.warnings) {
      if (/printed no extended price/.test(warning)) diagnostics.push(warning);
      else warnings.push(warning);
    }
  }

  diagnostics.push(`Strategy: ${strategy}.`);
  return { items, clientInfo, summary, warnings, diagnostics, strategy, reconciliation };
};

/** Run every legacy strategy over every page, collecting whatever each one claims to find. */
function runLegacyStrategies(
  legacyPages: readonly LegacyPageInput[],
  state: LegacyState,
): LegacyResult[] {
  const results: LegacyResult[] = [];
  for (const strategy of LEGACY_STRATEGIES) {
    const collected: QuoteItem[] = [];
    // Anchors are carried alongside the items so the fallback path can still pair images.
    // These are bottom-origin PDF coordinates, exactly as the legacy strategies produced them.
    const anchors: { pageNumber: number; y: number }[] = [];
    for (const input of legacyPages) {
      if (!strategy.claims(input, state)) continue;
      try {
        const { items, yCoords } = strategy.run(input, state);
        items.forEach((item, index) => {
          collected.push(item);
          anchors.push({ pageNumber: input.pageNumber, y: yCoords[index] ?? 0 });
        });
      } catch {
        // A legacy strategy throwing must never take the parse down; the core already ran.
      }
    }
    results.push({
      name: strategy.name,
      items: collected.map((item) => ({ ...item, desc: cleanDescription(item.desc) })),
      anchors,
    });
  }
  return results;
}
