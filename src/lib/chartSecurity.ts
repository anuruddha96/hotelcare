// Chart security utilities to prevent CSS injection

const allowedColors = [
  // Standard CSS color names
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown',
  'black', 'white', 'gray', 'grey', 'silver', 'gold', 'navy', 'teal',
  'lime', 'aqua', 'maroon', 'olive', 'fuchsia', 'cyan', 'magenta',
  
  // Chart.js default colors
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40',
  '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384'
];

const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const rgbRegex = /^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/;
const rgbaRegex = /^rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-1](\.[0-9]+)?)\s*\)$/;
const hslRegex = /^hsl\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})%\s*,\s*([0-9]{1,3})%\s*\)$/;

/**
 * Validates and sanitizes color values for charts to prevent CSS injection
 */
export function sanitizeColor(color: string): string {
  if (!color || typeof color !== 'string') {
    return '#666666'; // Default safe color
  }

  const cleanColor = color.trim().toLowerCase();
  
  // Check against allowed color names
  if (allowedColors.includes(cleanColor)) {
    return cleanColor;
  }
  
  // Check hex colors
  if (hexColorRegex.test(color)) {
    return color;
  }
  
  // Check RGB colors
  if (rgbRegex.test(cleanColor)) {
    const match = cleanColor.match(rgbRegex);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      if (r <= 255 && g <= 255 && b <= 255) {
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
  }
  
  // Check RGBA colors
  if (rgbaRegex.test(cleanColor)) {
    const match = cleanColor.match(rgbaRegex);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      const a = parseFloat(match[4]);
      if (r <= 255 && g <= 255 && b <= 255 && a >= 0 && a <= 1) {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      }
    }
  }
  
  // Check HSL colors
  if (hslRegex.test(cleanColor)) {
    const match = cleanColor.match(hslRegex);
    if (match) {
      const h = parseInt(match[1]);
      const s = parseInt(match[2]);
      const l = parseInt(match[3]);
      if (h <= 360 && s <= 100 && l <= 100) {
        return `hsl(${h}, ${s}%, ${l}%)`;
      }
    }
  }
  
  // Return safe default if validation fails
  console.warn(`Invalid color value sanitized: ${color}`);
  return '#666666';
}

/**
 * Sanitizes chart configuration objects to prevent injection attacks
 */
export function sanitizeChartConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return {};
  }
  
  const sanitized = { ...config };
  
  // Recursively sanitize color values
  function sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('color') && typeof value === 'string') {
        result[key] = sanitizeColor(value);
      } else if (typeof value === 'object') {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  
  return sanitizeObject(sanitized);
}