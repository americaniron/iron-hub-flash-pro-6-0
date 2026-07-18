export type CountryOption = {
  value: string;
  label: string;
};

// ISO 3166-1 alpha-2 regions. Keeping this small reference list in-app avoids
// shipping a multi-megabyte city dataset just to render a country selector.
const ISO_COUNTRY_CODES = [
  'AF', 'AX', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BA', 'BW', 'BV', 'BR', 'IO',
  'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CA', 'CV', 'KY', 'CF', 'TD', 'CL', 'CN', 'CX', 'CC', 'CO',
  'KM', 'CG', 'CD', 'CK', 'CR', 'CI', 'HR', 'CU', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO', 'TL', 'EC',
  'EG', 'SV', 'GQ', 'ER', 'EE', 'ET', 'FK', 'FO', 'FJ', 'FI', 'FR', 'GF', 'PF', 'TF', 'GA', 'GM',
  'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP', 'GU', 'GT', 'GG', 'GN', 'GW', 'GY', 'HT', 'HM',
  'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL', 'IT', 'JM', 'JP', 'JE', 'JO', 'KZ',
  'KE', 'KI', 'KP', 'KR', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT', 'LU', 'MO',
  'MK', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'IM', 'MH', 'MQ', 'MR', 'MU', 'YT', 'MX', 'FM', 'MD',
  'MC', 'MN', 'ME', 'MS', 'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'BQ', 'NL', 'NC', 'NZ', 'NI', 'NE',
  'NG', 'NU', 'NF', 'MP', 'NO', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH', 'PN', 'PL',
  'PT', 'PR', 'QA', 'RE', 'RO', 'RU', 'RW', 'SH', 'KN', 'LC', 'PM', 'VC', 'BL', 'MF', 'WS', 'SM',
  'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS', 'SS', 'ES', 'LK',
  'SD', 'SR', 'SJ', 'SZ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TG', 'TK', 'TO', 'TT', 'TN',
  'TR', 'TM', 'TC', 'TV', 'UG', 'UA', 'AE', 'GB', 'US', 'UM', 'UY', 'UZ', 'VU', 'VA', 'VE', 'VN',
  'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW', 'XK', 'CW', 'SX',
] as const;

const countryCodes = new Set<string>(ISO_COUNTRY_CODES);
const displayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const normalizeCountryCode = (value: string | undefined): string => {
  const trimmed = value?.trim() || '';
  if (trimmed.toLowerCase() === 'united states') return 'US';
  const normalized = trimmed.toUpperCase();
  return countryCodes.has(normalized) ? normalized : trimmed;
};

export const countryName = (value: string | undefined): string => {
  const normalized = normalizeCountryCode(value);
  if (!normalized) return '';
  return countryCodes.has(normalized) ? displayNames?.of(normalized) || normalized : normalized;
};

export const COUNTRY_OPTIONS: CountryOption[] = ISO_COUNTRY_CODES
  .map((code) => ({ value: code, label: countryName(code) }))
  .sort((left, right) => left.label.localeCompare(right.label));
