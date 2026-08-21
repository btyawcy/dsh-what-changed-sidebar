export declare const name: string;
export declare const inject: string[];
export declare function apply(ctx: any): void;
export declare const whatChangedProjection: {
  key: string;
  schema: any;
  init: () => any;
  apply: (state: any, event: any) => any;
  view: (state: any) => any;
  stateVersion: number;
};
