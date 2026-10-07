// Stored in the existing profile color slot for compatibility with saved accounts and apps.
export const AVATARS = [
  { name: 'Red initial', file: null },
  { name: 'Smile', file: 'smile' },
  { name: 'Panda', file: 'panda' },
  { name: 'Cat', file: 'cat' },
  { name: 'Robot', file: 'robot' },
  { name: 'Fox', file: 'fox' },
  { name: 'Owl', file: 'owl' },
  { name: 'Astronaut', file: 'astronaut' },
];
export const avatarOption = (index) => AVATARS[Number.isInteger(index) ? index : 0] || AVATARS[0];
