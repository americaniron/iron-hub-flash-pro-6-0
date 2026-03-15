
import { QuoteItem, ClientInfo } from '../types.ts';

// --- Helper Functions ---

/**
 * Aggressive cleaning to ensure only American Iron LLC and CAT engineering data remains.
 * Removes third-party vendor names, web addresses, and generic boilerplate.
 */
function cleanDescription(text: string): string {
  if (!text) return "";

  let cleaned = String(text)
    .replace(/\/\/parts\.cat\.com\/[^\s]*/gi, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    // Aggressive vendor removal - covering all known suppliers
    .replace(/Ring Power|RING POWER CORPORATION|Industrial Parts Depot|IPD|COSTEX|CAT|CTP|Costex Tractor Parts|Trak-Tek|Heavy Equipment|Replacement Parts|Genuine Parts|Aftermarket|Kelly Tractor|Pantropic|Thompson Tractor/gi, "")
    // Metadata/Location removal
    .replace(/Tampa|Riverview|Fern Hill|ADAM qadah|americanyellowiron\.com|cat\.com|Authorized Dealer|Sales Representative/gi, "")
    .replace(/10421 Fern Hill Dr\.|813-671-3700|33578|United States|Florida|Orlando|Jacksonville|Fort Myers/gi, "")
    .replace(/Page \d+ of \d+/gi, "")
    // Field label removal
    .replace(/\b(Unit Price|Extended Price|Total Price|Product Description|Availability|Notes|Quantity|Part Number|Description|Item|Warehouse|Loc|Ship|Ref|Code|Status|Wgt|Weight|Lbs|Kgs)\b/gi, "")
    .replace(/ORDER SUBTOTAL|ORDER TOTAL|SUBTOTAL|TAX|TOTAL DUE|SUMMARY OF CHARGES|GRAND TOTAL/gi, "")
    .replace(/\(USD\)/g, "")
    .replace(/[\|:]/g, " ")
    .trim();

  // Remove leading line indices like "1) ", "31. "
  cleaned = cleaned.replace(/^(?:\d+[\s)\.]*)+/, "");
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Specifically removes summary-level text that can get mixed into line item descriptions.
 */
function cleanLineOfSummaryJunk(text: string): string {
  if (!text) return "";
  return text
    // Remove specific summary keywords and everything after them on the line
    .replace(/(SHIPPING\/MISCELLANEOUS|ORDER SUBTOTAL|ORDER TOTAL|HTTPS\?|LANGID=|STATUS:).*/i, '')
    // Also attempt to remove stray prices that might have been merged into the description
    .replace(/\s+\$\s?[\d,]+\.\d{2}\s*/, ' ')
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
    /Ship\s+\d{1,2}\/\d{2,4}/i
  ];

  let availability = "";
  let remainingText = text;

  for (const pat of availPatterns) {
    const m = text.match(pat);
    if (m) {
      availability = m[0];
      remainingText = remainingText.replace(pat, " ").trim();
      break;
    }
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
  let text = lineText.trim();
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
  const availResult = extractAvailability(text);
  if (availResult.availability) {
    item.availability = (item.availability ? item.availability + ' ' : '') + availResult.availability;
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
    const text = lineObj.text;
    
    // Check if we hit a summary or new section that indicates end of items
    if (/ORDER SUBTOTAL|SUMMARY OF CHARGES|PROMOTIONS & OFFERS|BILLING METHOD/i.test(text)) {
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
 * John Deere specific line-item parser.
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

export const parseTextData = (text: string): QuoteItem[] => {
  const lines = text.split('\n').map((l, i) => ({ y: i * 20, text: l }));
  let result = parseRingPowerPage(lines);
  if (result.items.length === 0) result = parseFallback(lines);
  if (result.items.length === 0) result = parseFuzzy(lines);
  return result.items;
};

export const parseExcelFile = async (file: File): Promise<QuoteItem[]> => {
  const data = await file.arrayBuffer();
  const workbook = window.XLSX.read(data, { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
  return jsonData.map((row: any) => {
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
};

export const parsePdfFile = async (file: File): Promise<{items: QuoteItem[], clientInfo: Partial<ClientInfo>}> => {
  if (!window.pdfjsLib) throw new Error("PDF Engine not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullItems: QuoteItem[] = [];
  let clientInfo: Partial<ClientInfo> = {};
  
  // State persistence across pages
  let isRingDocument = false;
  let isJohnDeereDocument = false;
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const linesMap = new Map<number, any[]>();
    
    textContent.items.forEach((item: any) => {
      const y = Math.round(item.transform[5]);
      let matchY: number | undefined;
      for (const key of linesMap.keys()) { 
        if (Math.abs(key - y) <= 8) { matchY = key; break; } 
      }
      if (matchY === undefined) { 
        matchY = y; 
        linesMap.set(matchY, []); 
      }
      linesMap.get(matchY)!.push(item);
    });

    const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
    const textLines = sortedY.map(y => ({
      y,
      text: linesMap.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str).join(' ').trim()
    })).filter(l => l.text.length > 0);

    const rawItems: RawTextItem[] = textContent.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height
    })).filter((it: any) => it.text.trim().length > 0);

    const pageText = textLines.map(l => l.text).join(' ');
    
    // Identity check on every page to ensure state is maintained
    if (/Ring Power|RING POWER CORPORATION/i.test(pageText)) {
        isRingDocument = true;
    }
    if (/John Deere|Dobbs Equipment/i.test(pageText)) {
        isJohnDeereDocument = true;
    }

    if (pageNum === 1) {
        clientInfo = extractClientInfo(textLines);
    }

    let pageItems: QuoteItem[] = [];
    let yCoords: number[] = [];

    // Prioritize specialized parser if document type is known
    if (isRingDocument) {
        const result = parseRingPowerPage(textLines, pageNum > 1);
        pageItems = result.items;
        yCoords = result.yCoords;
    } else if (isJohnDeereDocument) {
        const result = parseJohnDeerePage(textLines);
        pageItems = result.items;
        yCoords = result.yCoords;
    } else {
        const tableResult = parseTableBasedPage(rawItems);
        if (tableResult.items.length > 0) {
            pageItems = tableResult.items;
            yCoords = tableResult.yCoords;
        }
    }
    
    // Fallbacks if specialized parser didn't catch items or if it's an unknown document type
    if (pageItems.length === 0) {
        const fbResult = parseFallback(textLines);
        pageItems = fbResult.items;
        yCoords = fbResult.yCoords;
        
        if (pageItems.length === 0) {
           const fuzzyResult = parseFuzzy(textLines);
           pageItems = fuzzyResult.items;
           yCoords = fuzzyResult.yCoords;
        }
    }

    // --- Image Extraction Logic ---
    const images: { y: number, x: number, dataUrl: string, width: number, height: number }[] = [];
    
    const processOperatorList = async (fnArray: any[], argsArray: any[], initialTransform: number[], depth: number = 0) => {
        if (depth > 5) return; // Prevent infinite recursion
        const transformStack: any[] = [];
        let currentTransform = [...initialTransform];

        for (let i = 0; i < fnArray.length; i++) {
            // Yield to main thread every 5000 operations to prevent UI freeze
            if (i % 5000 === 0 && i > 0) {
                await new Promise(r => setTimeout(r, 0));
            }
            
            const fn = fnArray[i];
            const args = argsArray[i];

            if (fn === window.pdfjsLib.OPS.save) {
                transformStack.push([...currentTransform]);
            } else if (fn === window.pdfjsLib.OPS.restore) {
                currentTransform = transformStack.pop() || [1, 0, 0, 1, 0, 0];
            } else if (fn === window.pdfjsLib.OPS.transform) {
                currentTransform = window.pdfjsLib.Util.transform(currentTransform, args);
            } else if (fn === window.pdfjsLib.OPS.paintImageXObject || fn === window.pdfjsLib.OPS.paintInlineImageXObject) {
                try {
                    let imgData: any = null;
                    if (fn === window.pdfjsLib.OPS.paintImageXObject) {
                        const imgKey = args[0];
                        try {
                            imgData = page.objs.get(imgKey);
                            if (imgData instanceof Promise) {
                                imgData = await imgData;
                            }
                        } catch (e) {
                            console.warn("Failed to get image object", e);
                        }
                    } else {
                        imgData = args[0];
                    }
                    
                    if (imgData) {
                        const width = imgData.width || (imgData.bitmap && imgData.bitmap.width) || imgData.naturalWidth;
                        const height = imgData.height || (imgData.bitmap && imgData.bitmap.height) || imgData.naturalHeight;
                        
                        // Filter out tiny images (likely icons or spacers)
                        if (!width || !height || width < 20 || height < 20) continue;

                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                            if (imgData.bitmap) {
                                ctx.drawImage(imgData.bitmap, 0, 0);
                            } else if (imgData.data) {
                                const imageData = ctx.createImageData(width, height);
                                const data = imgData.data;
                                const pixels = imageData.data;
                                
                                if (data.length === width * height * 3) {
                                    for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
                                        pixels[q] = data[p]; pixels[q+1] = data[p+1]; pixels[q+2] = data[p+2]; pixels[q+3] = 255;
                                    }
                                } else if (data.length === width * height * 4) {
                                    pixels.set(data);
                                } else if (data.length === width * height) {
                                    for (let p = 0, q = 0; p < data.length; p++, q += 4) {
                                        pixels[q] = pixels[q+1] = pixels[q+2] = data[p]; pixels[q+3] = 255;
                                    }
                                }
                                ctx.putImageData(imageData, 0, 0);
                            } else if (imgData instanceof HTMLImageElement || imgData instanceof HTMLCanvasElement || imgData instanceof ImageBitmap) {
                                ctx.drawImage(imgData, 0, 0);
                            }
                            images.push({ 
                                y: currentTransform[5], 
                                x: currentTransform[4],
                                width: width,
                                height: height,
                                dataUrl: canvas.toDataURL("image/jpeg", 0.8) 
                            });
                        }
                    }
                } catch (e) { console.warn("Error extracting image", e); }
            } else if (fn === window.pdfjsLib.OPS.paintFormXObject) {
                try {
                    const formKey = args[0];
                    let form: any = null;
                    try {
                        form = page.objs.get(formKey);
                        if (form instanceof Promise) {
                            form = await form;
                        }
                    } catch (e) {
                        console.warn("Failed to get form object", e);
                    }
                    if (form && form.fnArray && form.argsArray) {
                        await processOperatorList(form.fnArray, form.argsArray, currentTransform, depth + 1);
                    }
                } catch (e) { console.warn("Error extracting form", e); }
            }
        }
    };

    try {
        const operatorList = await page.getOperatorList();
        await processOperatorList(operatorList.fnArray, operatorList.argsArray, [1, 0, 0, 1, 0, 0]);
    } catch (e) { console.warn("Could not parse images from PDF page.", e); }

    // Associate extracted images with items on this page
    // Robust matching: Find the image closest to the item's Y coordinate
    const availableImages = [...images];
    pageItems.forEach((item, idx) => {
      const itemY = yCoords[idx];
      let bestImgIdx = -1;
      let minDiff = Infinity;
      
      availableImages.forEach((img, i) => {
        const diff = Math.abs(img.y - itemY);
        // Increased threshold to 300 for better tolerance on complex layouts
        if (diff < minDiff && diff < 300) { 
          minDiff = diff; 
          bestImgIdx = i; 
        }
      });
      
      if (bestImgIdx !== -1) {
          item.originalImages = [availableImages[bestImgIdx].dataUrl];
          availableImages.splice(bestImgIdx, 1);
      }
    });

    fullItems.push(...pageItems);
  }

  fullItems = fullItems.map(item => ({
    ...item,
    desc: cleanDescription(item.desc)
  }));

  if (fullItems.length === 0) {
    throw new Error("No items detected in source. Please check the document format.");
  }

  return { items: fullItems, clientInfo };
};
