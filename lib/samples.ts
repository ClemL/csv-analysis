/** Small built-in datasets used by the "load a sample" buttons. */

export interface Sample {
  id: string;
  label: string;
  /** Shown beside the label in the samples menu. */
  hint: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'comma',
    label: 'Comma',
    hint: 'quoted fields, nulls',
    text: [
      'claim_id,ndc,fill_date,quantity,unit_cost,pharmacy,covered_entity,notes',
      '10001,00093-7146-56,2026-01-04,30,12.45,"Walgreens #4412, Arlington",BILH,',
      '10002,00378-3855-93,2026-01-04,90,4.10,CVS #1120,BILH,refill',
      '10003,00093-7146-56,2026-01-05,30,12.45,Walgreens #4412,BILH,NULL',
      '10004,69097-0128-02,2026-01-06,60,,Mail Order,BILH,"price pending, vendor: Optum"',
      '10005,00378-3855-93,2026-01-07,90,4.10,CVS #1120,BILH,',
    ].join('\n'),
  },
  {
    id: 'pipe',
    label: 'Pipe',
    hint: 'dates, booleans',
    text: [
      'member_id|last_name|first_name|dob|plan|active',
      '88231|Nguyen|Thanh|1984-03-11|PBM-GOLD|true',
      '88232|Patel|Parth|1979-11-02|PBM-GOLD|true',
      '88233|Rao|Srini|1990-06-24|PBM-SILVER|false',
      '88234|Okafor|Sherman||PBM-SILVER|true',
    ].join('\n'),
  },
  {
    id: 'triplePipe',
    label: 'Triple pipe',
    hint: 'separators, negatives',
    text: [
      'record_id|||source_system|||amount|||posted_at|||status',
      '5001|||PharmaForce|||1,204.55|||2026-02-01 08:15:00|||POSTED',
      '5002|||Sentry|||-88.20|||2026-02-01 09:02:00|||REVERSED',
      '5003|||Optum|||430.00|||2026-02-02 11:47:00|||POSTED',
      '5004|||PharmaForce|||N/A|||2026-02-03 14:20:00|||PENDING',
    ].join('\n'),
  },
  {
    id: 'tab',
    label: 'Tab',
    hint: 'blank cells',
    text: [
      ['server', 'database', 'size_mb', 'last_backup', 'geo_replicated'].join('\t'),
      ['sql-prod-01', 'claims', '184320', '2026-03-01', 'yes'].join('\t'),
      ['sql-prod-01', 'eligibility', '20480', '2026-03-01', 'yes'].join('\t'),
      ['sql-prod-02', 'staging', '5120', '2026-02-27', 'no'].join('\t'),
      ['sql-dev-01', 'sandbox', '512', '', 'no'].join('\t'),
    ].join('\n'),
  },
];
