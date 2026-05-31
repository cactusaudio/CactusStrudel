declare module '@strudel/web' {
  export const initStrudel: (...args: any[]) => any;
  export const evaluate: (...args: any[]) => any;
  export const hush: (...args: any[]) => any;
}

declare module '@strudel/webaudio' {
  export const getSound: (...args: any[]) => any;
  export const renderPatternAudio: (...args: any[]) => any;
  export const getAudioContext: (...args: any[]) => any;
}

declare module '@strudel/soundfonts' {
  const soundfonts: any;
  export default soundfonts;
}

declare module '@strudel/core' {
  export const noteToMidi: (...args: any[]) => any;
  export const freqToMidi: (...args: any[]) => any;
}
