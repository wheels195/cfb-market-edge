/**
 * Weather Impact Analysis for CFB Betting
 *
 * Based on historical CFB betting research:
 * - High wind (>15 mph) significantly reduces scoring, especially passing
 * - Extreme cold (<32°F) affects ball handling and kicking
 * - Rain reduces scoring by ~3-5 points
 * - Snow can reduce scoring by 5-10 points
 * - Extreme heat (>90°F) can affect late-game performance
 */

import { CFBDWeather, WeatherImpact } from '@/types/cfbd-api';

// Weather thresholds based on betting research
const THRESHOLDS = {
  wind: {
    minor: 15,    // mph - starts affecting passing
    moderate: 20, // mph - significant impact
    severe: 25,   // mph - major impact, game script changes
  },
  temperature: {
    coldMinor: 40,    // °F - start of cold weather impact
    coldModerate: 32, // °F - freezing, significant impact
    coldSevere: 20,   // °F - extreme cold
    hotMinor: 90,     // °F - heat fatigue begins
    hotModerate: 95,  // °F - significant heat
  },
  precipitation: {
    minor: 0.1,    // inches - light rain
    moderate: 0.25, // inches - moderate rain
    severe: 0.5,   // inches - heavy rain
  },
  snow: {
    minor: 0.5,   // inches
    moderate: 2,  // inches
    severe: 4,    // inches
  },
};

// Point adjustments for totals based on weather
const TOTAL_ADJUSTMENTS = {
  wind: {
    minor: -2,    // pts
    moderate: -4,
    severe: -7,
  },
  cold: {
    minor: -1,
    moderate: -3,
    severe: -5,
  },
  heat: {
    minor: 0,
    moderate: -1,
  },
  rain: {
    minor: -2,
    moderate: -4,
    severe: -6,
  },
  snow: {
    minor: -4,
    moderate: -7,
    severe: -10,
  },
};

type Severity = 'none' | 'minor' | 'moderate' | 'severe';

// Severity ranking for comparison
const SEVERITY_RANK: Record<Severity, number> = {
  'none': 0,
  'minor': 1,
  'moderate': 2,
  'severe': 3,
};

function updateSeverity(current: Severity, newLevel: Severity): Severity {
  return SEVERITY_RANK[newLevel] > SEVERITY_RANK[current] ? newLevel : current;
}

/**
 * Analyze weather impact on a game
 */
export function analyzeWeatherImpact(weather: CFBDWeather | null): WeatherImpact {
  // No weather data or indoor game
  if (!weather || weather.gameIndoors) {
    return {
      hasImpact: false,
      severity: 'none',
      factors: [],
      totalAdjustment: 0,
      spreadAdjustment: 0,
    };
  }

  const factors: string[] = [];
  let totalAdjustment = 0;
  let spreadAdjustment = 0;
  let maxSeverity: Severity = 'none';

  // Analyze wind
  if (weather.windSpeed !== null) {
    if (weather.windSpeed >= THRESHOLDS.wind.severe) {
      factors.push(`SEVERE WIND: ${weather.windSpeed} mph - major impact on passing game`);
      totalAdjustment += TOTAL_ADJUSTMENTS.wind.severe;
      spreadAdjustment += 2; // Favors run-heavy teams
      maxSeverity = updateSeverity(maxSeverity, 'severe');
    } else if (weather.windSpeed >= THRESHOLDS.wind.moderate) {
      factors.push(`HIGH WIND: ${weather.windSpeed} mph - significant passing impact`);
      totalAdjustment += TOTAL_ADJUSTMENTS.wind.moderate;
      spreadAdjustment += 1;
      maxSeverity = updateSeverity(maxSeverity, 'moderate');
    } else if (weather.windSpeed >= THRESHOLDS.wind.minor) {
      factors.push(`WIND: ${weather.windSpeed} mph - may affect deep passes`);
      totalAdjustment += TOTAL_ADJUSTMENTS.wind.minor;
      maxSeverity = updateSeverity(maxSeverity, 'minor');
    }
  }

  // Analyze temperature
  if (weather.temperature !== null) {
    if (weather.temperature <= THRESHOLDS.temperature.coldSevere) {
      factors.push(`EXTREME COLD: ${weather.temperature}°F - affects ball handling, kicking`);
      totalAdjustment += TOTAL_ADJUSTMENTS.cold.severe;
      maxSeverity = updateSeverity(maxSeverity, 'severe');
    } else if (weather.temperature <= THRESHOLDS.temperature.coldModerate) {
      factors.push(`FREEZING: ${weather.temperature}°F - cold weather impact`);
      totalAdjustment += TOTAL_ADJUSTMENTS.cold.moderate;
      maxSeverity = updateSeverity(maxSeverity, 'moderate');
    } else if (weather.temperature <= THRESHOLDS.temperature.coldMinor) {
      factors.push(`COLD: ${weather.temperature}°F`);
      totalAdjustment += TOTAL_ADJUSTMENTS.cold.minor;
      maxSeverity = updateSeverity(maxSeverity, 'minor');
    } else if (weather.temperature >= THRESHOLDS.temperature.hotModerate) {
      factors.push(`EXTREME HEAT: ${weather.temperature}°F - fatigue factor`);
      totalAdjustment += TOTAL_ADJUSTMENTS.heat.moderate;
      maxSeverity = updateSeverity(maxSeverity, 'minor');
    } else if (weather.temperature >= THRESHOLDS.temperature.hotMinor) {
      factors.push(`HOT: ${weather.temperature}°F`);
    }
  }

  // Analyze precipitation
  if (weather.precipitation !== null && weather.precipitation > 0) {
    if (weather.precipitation >= THRESHOLDS.precipitation.severe) {
      factors.push(`HEAVY RAIN: ${weather.precipitation}" - wet ball, slippery field`);
      totalAdjustment += TOTAL_ADJUSTMENTS.rain.severe;
      spreadAdjustment += 1.5;
      maxSeverity = updateSeverity(maxSeverity, 'severe');
    } else if (weather.precipitation >= THRESHOLDS.precipitation.moderate) {
      factors.push(`RAIN: ${weather.precipitation}" - moderate precipitation`);
      totalAdjustment += TOTAL_ADJUSTMENTS.rain.moderate;
      spreadAdjustment += 1;
      maxSeverity = updateSeverity(maxSeverity, 'moderate');
    } else if (weather.precipitation >= THRESHOLDS.precipitation.minor) {
      factors.push(`LIGHT RAIN: ${weather.precipitation}"`);
      totalAdjustment += TOTAL_ADJUSTMENTS.rain.minor;
      maxSeverity = updateSeverity(maxSeverity, 'minor');
    }
  }

  // Analyze snowfall (takes precedence over rain)
  if (weather.snowfall !== null && weather.snowfall > 0) {
    if (weather.snowfall >= THRESHOLDS.snow.severe) {
      factors.push(`HEAVY SNOW: ${weather.snowfall}" - major field conditions impact`);
      totalAdjustment += TOTAL_ADJUSTMENTS.snow.severe;
      spreadAdjustment += 3;
      maxSeverity = updateSeverity(maxSeverity, 'severe');
    } else if (weather.snowfall >= THRESHOLDS.snow.moderate) {
      factors.push(`SNOW: ${weather.snowfall}" - significant conditions impact`);
      totalAdjustment += TOTAL_ADJUSTMENTS.snow.moderate;
      spreadAdjustment += 2;
      maxSeverity = updateSeverity(maxSeverity, 'severe');
    } else if (weather.snowfall >= THRESHOLDS.snow.minor) {
      factors.push(`LIGHT SNOW: ${weather.snowfall}"`);
      totalAdjustment += TOTAL_ADJUSTMENTS.snow.minor;
      spreadAdjustment += 1;
      maxSeverity = updateSeverity(maxSeverity, 'moderate');
    }
  }

  // Add weather condition description if unusual
  if (weather.weatherCondition &&
      !['Fair', 'Clear', 'Sunny', 'Partly Cloudy'].includes(weather.weatherCondition)) {
    const conditionLower = weather.weatherCondition.toLowerCase();
    if (conditionLower.includes('thunderstorm')) {
      factors.push(`THUNDERSTORM CONDITIONS`);
      totalAdjustment += -3;
      maxSeverity = updateSeverity(maxSeverity, 'moderate');
    }
  }

  return {
    hasImpact: factors.length > 0,
    severity: maxSeverity,
    factors,
    totalAdjustment: Math.round(totalAdjustment * 10) / 10,
    spreadAdjustment: Math.round(spreadAdjustment * 10) / 10,
  };
}

/**
 * Generate weather warning messages for edges
 */
export function getWeatherWarnings(impact: WeatherImpact): string[] {
  if (!impact.hasImpact) return [];

  const warnings: string[] = [];

  if (impact.severity === 'severe') {
    warnings.push(`WEATHER ALERT: Severe conditions expected (${impact.factors[0]})`);
  } else if (impact.severity === 'moderate') {
    warnings.push(`WEATHER: ${impact.factors.join(', ')}`);
  }

  if (Math.abs(impact.totalAdjustment) >= 5) {
    warnings.push(`Weather suggests total adjustment of ${impact.totalAdjustment} pts`);
  }

  return warnings;
}

/**
 * Check if weather data suggests model error
 * Returns true if weather could explain a large edge
 */
export function weatherExplainsLargeEdge(
  impact: WeatherImpact,
  edgePoints: number,
  marketType: 'spread' | 'total'
): boolean {
  if (!impact.hasImpact) return false;

  if (marketType === 'total') {
    // Weather could explain Under edge if model doesn't account for conditions
    if (edgePoints > 0 && impact.totalAdjustment < -3) {
      return true;
    }
  }

  // Severe weather often creates larger edges due to uncertainty
  if (impact.severity === 'severe' && Math.abs(edgePoints) > 5) {
    return true;
  }

  return false;
}
