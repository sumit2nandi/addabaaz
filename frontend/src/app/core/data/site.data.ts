import { ServiceItem, TeamMember } from '../models/content';

/** Contact endpoints, social links and the Google Form used by the inquiry form. */
export const CONTACT_DETAILS = {
  email: 'office@addabaaz.in',
  phones: ['+91 90074 17916', '+91 90077 71995'],
  landline: '+91 33318 66791',
  whatsapp: {
    number: '+91 74397 41537',
    url: 'https://wa.me/917439741537?text=Hello%20ADDABAAZ%2C%20I%27d%20like%20to%20discuss%20a%20project.',
  },
  address: ['162/B, 283 Lake Gardens', 'Kolkata, West Bengal 700045', 'India'],
  mapsUrl: 'https://maps.app.goo.gl/4pKaxqR8CGJ5S6Fd7',
  social: [
    { label: 'Facebook', icon: 'fab fa-facebook-f', url: 'https://www.facebook.com/ADDABAAZDEEP' },
    { label: 'Instagram', icon: 'fab fa-instagram', url: 'https://www.instagram.com/addabaazdeep' },
    { label: 'YouTube', icon: 'fab fa-youtube', url: 'https://www.youtube.com/@ADDABAAZ01' },
  ],
} as const;

/**
 * Inquiry form transport.
 * - `appsScriptUrl`: set to an Apps Script web-app URL to receive JSON.
 * - `googleFormAction` + `googleFormFields`: used when no Apps Script is set.
 * Leave both empty to run in "console only" mode.
 */
export const FORM_CONFIG = {
  appsScriptUrl: '',
  googleFormAction:
    'https://docs.google.com/forms/d/e/1FAIpQLSefTIXeGfnzRR7oumsp1wsSvoOjEWjtK-opcCN5T1LR0ZE7fA/formResponse',
  googleFormFields: {
    name: 'entry.1034004557',
    email: 'entry.608979481',
    phone: 'entry.641949480',
    message: 'entry.548756118',
  },
} as const;

export const MISSION_BENGALI: readonly string[] = [
  'নতুন ও মৌলিক গল্পের মাধ্যমে দর্শকের মনে গভীর ছাপ তৈরি করা।',
  'সিনেমা ও বিজ্ঞাপনে সৃজনশীলতা, গুণমান এবং নতুন ভাবনার সংমিশ্রণ ঘটানো।',
  'প্রতিভাবান লেখক, পরিচালক ও শিল্পীদের তাঁদের নিজস্ব গল্প বলার সুযোগ করে দেওয়া।',
  'স্থানীয় গল্পকে আন্তর্জাতিক মানের ভিজ্যুয়াল ও নির্মাণশৈলীতে তুলে ধরা।',
  'এমন চলচ্চিত্র ও বিজ্ঞাপন তৈরি করা, যা শুধু দেখা নয়—অনুভব ও মনে রাখার মতো।',
];

export const MISSION_ENGLISH: readonly string[] = [
  'Creating a lasting impact through original, compelling storytelling.',
  'Blending artistic creativity, high production quality, and innovative concepts in cinema & advertising.',
  'Empowering visionaries, emerging writers, directors, and artists to express their authentic voices.',
  'Elevating hyper-local narratives onto a global stage with world-class visuals and craftsmanship.',
  'Crafting cinematic experiences and brand commercials that resonate emotionally and remain unforgettable.',
];

export const TEAM: readonly TeamMember[] = [
  {
    name: 'Deep',
    role: '🎬 Creative Director',
    image: 'images/Team/Deep.png',
    quote: '“Create your own ideas, tell your own stories—that’s where films are born.”',
  },
  {
    name: 'S. Sikdar',
    role: '🎥 Brand Director',
    image: 'images/Team/S_Sikdar.png',
    quote:
      '“Leaders emphasize that brands live in the mind, defined by customer perception, stories, and relationships rather than just factory output.”',
  },
  { name: 'Rajdeep Ghosh', role: '🎞️ Film Director', image: 'images/Team/Rajdeep.png' },
  { name: 'Sujoy Sarkar', role: '🎞️ Film Director', image: 'images/Team/Sujoy.png' },
  { name: 'Anuraag Pati', role: '🎞️ Film Director', image: 'images/Team/Anuraag.png' },
  {
    name: 'Ashim Das',
    role: '✂️ Film Editor',
    image: 'images/Team/Ashim.png',
    quote: 'The storyteller behind the cut — shaping moments, emotions and rhythm into cinema.',
  },
  {
    name: 'Anupam Gupta Roy',
    role: '✂️ Film Editor',
    image: 'images/Team/Anupam.png',
    quote: 'The storyteller behind the cut — shaping moments, emotions and rhythm into cinema.',
  },
  {
    name: 'Sourav Chatterjee',
    role: '📸 Director of Photography (DOP)',
    image: 'images/Team/Sourav.png',
    quote:
      '“Focus on visual storytelling, lighting for mood, and translating a director’s vision into moving images.”',
  },
  {
    name: 'Rupak Chakraborty',
    role: '✍️ Writer & Screenplay Director',
    image: 'images/Team/Rupak.png',
    quote: '“Let every word become a clear, captivating, and meaningful story.”',
  },
];

export const SERVICES: readonly ServiceItem[] = [
  {
    num: '01',
    title: 'Film Production',
    description:
      'Developing and executing full-length feature films, indie projects, and short films from initial narrative concept to silver screen release.',
  },
  {
    num: '02',
    title: 'Ad Film Production',
    description:
      'Translating brand visions and corporate identities into high-impact visual stories, TV commercials, and digital brand films.',
  },
  {
    num: '03',
    title: 'Direction & Production',
    description:
      'Providing end-to-end creative leadership and technical production management across pre-production, principal photography, and post-production.',
  },
  {
    num: '04',
    title: 'Script & Storytelling',
    description:
      'Nurturing raw ideas into polished screenplays, sharp dialogues, and deeply engaging cinematic narratives engineered for emotional resonance.',
  },
  {
    num: '05',
    title: 'Cinematic Visuals',
    description:
      'Crafting a signature visual aesthetic through modern camera work, artistic lighting design, expert color grading, and meticulous creative direction.',
  },
  {
    num: '06',
    title: 'Digital Content',
    description:
      'Producing trend-defining digital shows, web series, webcasts, and high-converting video assets optimized for OTT platforms, YouTube, and social media.',
  },
];
