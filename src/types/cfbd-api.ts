// Types for CollegeFootballData API responses
// Note: API returns camelCase

export interface CFBDGame {
  id: number;
  season: number;
  week: number;
  seasonType: 'regular' | 'postseason';
  startDate: string;
  startTimeTBD: boolean;
  completed: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  attendance: number | null;
  venueId: number | null;
  venue: string | null;
  homeId: number;
  homeTeam: string;
  homeConference: string | null;
  homeClassification: string | null;
  homePoints: number | null;
  homeLineScores: number[] | null;
  homePostgameWinProbability: number | null;
  homePregameElo: number | null;
  homePostgameElo: number | null;
  awayId: number;
  awayTeam: string;
  awayConference: string | null;
  awayClassification: string | null;
  awayPoints: number | null;
  awayLineScores: number[] | null;
  awayPostgameWinProbability: number | null;
  awayPregameElo: number | null;
  awayPostgameElo: number | null;
  excitementIndex: number | null;
  highlights: string | null;
  notes: string | null;
}

export interface CFBDTeam {
  id: number;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  alt_name1: string | null;
  alt_name2: string | null;
  alt_name3: string | null;
  classification: string | null;
  conference: string | null;
  division: string | null;
  color: string | null;
  alt_color: string | null;
  logos: string[] | null;
  twitter: string | null;
  location: {
    venue_id: number | null;
    name: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country_code: string | null;
    timezone: string | null;
    latitude: number | null;
    longitude: number | null;
    elevation: string | null;
    capacity: number | null;
    year_constructed: number | null;
    grass: boolean | null;
    dome: boolean | null;
  } | null;
}

export interface CFBDTeamStats {
  team: string;
  conference: string;
  homeGames: number;
  awayGames: number;
  homeWins: number;
  awayWins: number;
  totalPoints: number;
  totalPointsAllowed: number;
}

export interface CFBDWeather {
  id: number;
  season: number;
  week: number;
  seasonType: 'regular' | 'postseason';
  startTime: string;
  gameIndoors: boolean;
  homeTeam: string;
  homeConference: string | null;
  awayTeam: string;
  awayConference: string | null;
  venueId: number | null;
  venue: string | null;
  temperature: number | null; // Fahrenheit
  dewPoint: number | null;
  humidity: number | null; // Percentage
  precipitation: number | null; // inches
  snowfall: number | null; // inches
  windDirection: number | null; // degrees
  windSpeed: number | null; // mph
  pressure: number | null; // millibars
  weatherConditionCode: number | null;
  weatherCondition: string | null;
}

export interface WeatherImpact {
  hasImpact: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  factors: string[];
  totalAdjustment: number; // Points adjustment to total
  spreadAdjustment: number; // Points adjustment favoring run-heavy teams
}

// Live Scoreboard Types
export interface CFBDScoreboardGame {
  id: number;
  startDate: string;
  startTimeTBD: boolean;
  tv: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  status: 'scheduled' | 'in_progress' | 'completed';
  period: number | null;
  clock: string | null;
  situation: string | null; // e.g., "3rd & 13 at ARMY 42"
  possession: 'home' | 'away' | null;
  lastPlay: string | null;
  venue: {
    name: string;
    city: string;
    state: string;
  } | null;
  homeTeam: {
    id: number;
    name: string;
    conference: string;
    classification: string;
    points: number | null;
    lineScores: number[] | null;
    winProbability: number | null;
  };
  awayTeam: {
    id: number;
    name: string;
    conference: string;
    classification: string;
    points: number | null;
    lineScores: number[] | null;
    winProbability: number | null;
  };
  weather: {
    temperature: number | null;
    description: string | null;
    windSpeed: number | null;
    windDirection: number | null;
  } | null;
  betting: {
    spread: number | null;
    overUnder: number | null;
    homeMoneyline: number | null;
    awayMoneyline: number | null;
  } | null;
}

// Betting Lines Types
export interface CFBDBettingLine {
  provider: string;
  spread: number | null;
  formattedSpread: string | null;
  spreadOpen: number | null;
  overUnder: number | null;
  overUnderOpen: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export interface CFBDGameLines {
  id: number;
  season: number;
  seasonType: 'regular' | 'postseason';
  week: number;
  startDate: string;
  homeTeamId: number;
  homeTeam: string;
  homeConference: string | null;
  homeClassification: string | null;
  homeScore: number | null;
  awayTeamId: number;
  awayTeam: string;
  awayConference: string | null;
  awayClassification: string | null;
  awayScore: number | null;
  lines: CFBDBettingLine[];
}

// PPA (Predicted Points Added) Types
export interface CFBDPPAStats {
  overall: number;
  passing: number;
  rushing: number;
  firstDown: number;
  secondDown: number;
  thirdDown: number;
  cumulative?: {
    total: number;
    passing: number;
    rushing: number;
  };
}

export interface CFBDGamePPA {
  gameId: number;
  season: number;
  week: number;
  seasonType: 'regular' | 'postseason';
  team: string;
  conference: string;
  opponent: string;
  offense: CFBDPPAStats;
  defense: CFBDPPAStats;
}

export interface CFBDTeamPPA {
  season: number;
  conference: string;
  team: string;
  offense: CFBDPPAStats;
  defense: CFBDPPAStats;
}

// Advanced Metrics
export interface CFBDTeamRatings {
  year: number;
  team: string;
  conference: string;
  elo: number;
  fpi: number | null;
  srs: number | null;
  spOverall: number | null;
  spOffense: number | null;
  spDefense: number | null;
}

// Player Data Types
export interface CFBDPlayer {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  weight: number | null;
  height: number | null;
  jersey: number | null;
  year: number; // 1=FR, 2=SO, 3=JR, 4=SR, 5=5th year
  position: string;
  homeCity: string | null;
  homeState: string | null;
  homeCountry: string | null;
}

export interface CFBDPlayerStat {
  season: number;
  playerId: string;
  player: string;
  position: string;
  team: string;
  conference: string;
  category: 'passing' | 'rushing' | 'receiving' | 'defensive' | 'kicking' | 'punting' | 'kickReturns' | 'puntReturns';
  statType: string;
  stat: string;
}

export interface CFBDPlayerUsage {
  season: number;
  id: string;
  name: string;
  position: string;
  team: string;
  conference: string;
  usage: {
    overall: number;
    pass: number;
    rush: number;
    firstDown: number;
    secondDown: number;
    thirdDown: number;
    standardDowns: number;
    passingDowns: number;
  };
}

export interface CFBDTransferPortalPlayer {
  season: number;
  firstName: string;
  lastName: string;
  position: string;
  origin: string;
  destination: string | null;
  transferDate: string;
  rating: number | null;
  stars: number;
  eligibility: string;
}

// Key Player Analysis
export interface KeyPlayerAnalysis {
  team: string;
  season: number;
  keyPlayers: {
    qb: { name: string; usage: number; stats: Record<string, number> } | null;
    rb1: { name: string; usage: number; stats: Record<string, number> } | null;
    wr1: { name: string; usage: number; stats: Record<string, number> } | null;
    topDefender: { name: string; tackles: number; sacks: number } | null;
  };
  transfersIn: CFBDTransferPortalPlayer[];
  transfersOut: CFBDTransferPortalPlayer[];
}
