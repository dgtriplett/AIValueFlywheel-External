// Catalog of utility data sources / datasets. Customers select what they
// have ingested or accessible — separate from use cases that are in production.
// Drives "data we have but aren't fully using yet" recommendations.

export type DataSourceCategory =
  | 'Operational'
  | 'Customer'
  | 'Asset'
  | 'Financial & Regulatory'
  | 'External';

export interface DataSource {
  id: string;
  name: string;
  description: string;
  category: DataSourceCategory;
  utilityTypes: string[];   // ['electric'], ['gas'], or ['electric','gas']
  /** Tag terms used to match this source against UseCase.dataRequirements */
  matchTerms: string[];
}

export const DATA_SOURCES: DataSource[] = [
  // ─── Operational ────────────────────────────────────────────────────────
  { id: 'ds_scada',          name: 'SCADA / Historian',                  description: 'Real-time grid telemetry from substations, feeders, and field devices', category: 'Operational', utilityTypes: ['electric'], matchTerms: ['scada','historian','telemetry'] },
  { id: 'ds_ami',            name: 'AMI Smart Meter Data',                description: 'Interval reads (15-min/hourly), last-gasp events, voltage data',         category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['ami','smart meter','interval','last-gasp'] },
  { id: 'ds_amr',            name: 'AMR Meter Reads',                     description: 'Drive-by or fixed-network monthly reads (pre-AMI)',                      category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['amr','meter read'] },
  { id: 'ds_oms',            name: 'OMS (Outage Management)',             description: 'Outage tickets, restoration history, customer impact',                    category: 'Operational', utilityTypes: ['electric'], matchTerms: ['oms','outage','restoration'] },
  { id: 'ds_dms',            name: 'DMS / ADMS',                          description: 'Distribution management — switching, voltage, FLISR state',               category: 'Operational', utilityTypes: ['electric'], matchTerms: ['dms','adms','flisr','distribution management'] },
  { id: 'ds_ems',            name: 'EMS (Energy Management)',             description: 'Bulk transmission state estimation, contingency analysis',               category: 'Operational', utilityTypes: ['electric'], matchTerms: ['ems','state estimation','transmission'] },
  { id: 'ds_gis',            name: 'GIS Network Model',                   description: 'ESRI / Smallworld — connectivity, customer-to-transformer mapping',      category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['gis','network model','connectivity','arcgis','smallworld'] },
  { id: 'ds_field_mobile',   name: 'Mobile Field / Crew Data',            description: 'Field service mobile app data, GPS, time-on-site',                       category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['mobile','field','crew'] },
  { id: 'ds_lidar',          name: 'LiDAR Point Clouds',                  description: 'Aerial / drone LiDAR for ROW clearance, asset condition',                category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['lidar','point cloud'] },
  { id: 'ds_drone',          name: 'Drone / Aerial Imagery',              description: 'Visual + thermal imagery from drone or helicopter inspections',          category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['drone','aerial','imagery','thermal'] },
  { id: 'ds_satellite',      name: 'Satellite Imagery',                   description: 'Sentinel / Planet / Maxar — multispectral, NDVI, methane plumes',         category: 'Operational', utilityTypes: ['electric','gas'], matchTerms: ['satellite','sentinel','planet','maxar','ndvi','methane'] },
  { id: 'ds_dcs_plant',      name: 'Generation Plant DCS / Historian',   description: 'Plant control system telemetry, vibration, fuel usage',                   category: 'Operational', utilityTypes: ['electric','generation_only'], matchTerms: ['dcs','plant','generation','vibration','fuel'] },

  // Gas operational
  { id: 'ds_cp',             name: 'Cathodic Protection Telemetry',       description: 'Test station readings, rectifier data',                                  category: 'Operational', utilityTypes: ['gas'], matchTerms: ['cathodic','rectifier','test station'] },
  { id: 'ds_ili',            name: 'Pipeline ILI / Smart Pig',            description: 'In-line inspection feature catalogs, defect history',                    category: 'Operational', utilityTypes: ['gas'], matchTerms: ['ili','smart pig','inspection','pipeline'] },
  { id: 'ds_methane',        name: 'Methane / Leak Survey',               description: 'Mobile sniffer, fixed-sensor, satellite methane data',                  category: 'Operational', utilityTypes: ['gas'], matchTerms: ['methane','leak','sniffer','picarro'] },
  { id: 'ds_compressor',     name: 'Compressor Station Telemetry',        description: 'Pressure, flow, fuel, vibration on compressor units',                    category: 'Operational', utilityTypes: ['gas'], matchTerms: ['compressor','station','fuel'] },
  { id: 'ds_storage_meter',  name: 'Gas Storage / LNG Telemetry',         description: 'Storage facility inventory, withdrawal/injection rates',                category: 'Operational', utilityTypes: ['gas'], matchTerms: ['storage','lng','injection','withdrawal'] },

  // ─── Customer ──────────────────────────────────────────────────────────
  { id: 'ds_cis',            name: 'CIS (Customer Information System)',  description: 'Customer master, accounts, premises, rate class',                        category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['cis','customer','account','billing'] },
  { id: 'ds_crm',            name: 'CRM (Salesforce / Dynamics)',         description: 'Cases, opportunities, marketing engagement history',                     category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['crm','salesforce','dynamics'] },
  { id: 'ds_billing',        name: 'Billing System',                       description: 'Bill detail, payment history, arrears, write-offs',                      category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['billing','payment','arrears'] },
  { id: 'ds_web_portal',     name: 'Web / Mobile Portal Telemetry',       description: 'Login frequency, payment activity, program enrollment clicks',           category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['web','portal','digital','self-service'] },
  { id: 'ds_call_center',    name: 'Call Center / IVR Logs + Transcripts',description: 'Call reasons, AHT, transcripts, satisfaction scores',                   category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['call center','ivr','transcript','agent'] },
  { id: 'ds_dsm',            name: 'DSM / Energy Efficiency Program Data',description: 'Rebates, audits, EE/DR enrollment',                                       category: 'Customer', utilityTypes: ['electric','gas'], matchTerms: ['dsm','demand response','energy efficiency','program'] },

  // ─── Asset ─────────────────────────────────────────────────────────────
  { id: 'ds_eam',            name: 'EAM / Asset Registry',                description: 'Maximo / SAP PM — asset master, condition, location',                    category: 'Asset', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['eam','maximo','asset','registry'] },
  { id: 'ds_workorders',     name: 'Work Orders & Maintenance History',  description: 'Planned + reactive work history, parts, labor',                          category: 'Asset', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['work order','maintenance','wo'] },
  { id: 'ds_iot_equipment',  name: 'Equipment IoT Sensors',               description: 'Vibration, temperature, oil analysis on rotating + heated equipment',    category: 'Asset', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['iot','sensor','vibration','temperature'] },
  { id: 'ds_inspections',    name: 'Inspection Reports',                   description: 'Substation/pipeline/asset inspection data, photos, findings',            category: 'Asset', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['inspection','condition'] },

  // ─── Financial & Regulatory ────────────────────────────────────────────
  { id: 'ds_erp',            name: 'ERP (SAP / Oracle / Workday)',        description: 'Financials, procurement, capital projects, HR',                          category: 'Financial & Regulatory', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['erp','sap','oracle','workday','financials'] },
  { id: 'ds_capital',        name: 'Capital Project Planning',            description: 'Primavera / MS Project — schedule, budget, actuals',                     category: 'Financial & Regulatory', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['capital','primavera','project'] },
  { id: 'ds_regulatory',     name: 'Regulatory Filings & Commitments',   description: 'PUC dockets, compliance deadlines, rate-case filings',                   category: 'Financial & Regulatory', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['regulatory','puc','docket','rate case','filing'] },
  { id: 'ds_iso_market',     name: 'ISO / RTO Market Data',               description: 'LMP, ancillary services, market schedules (PJM/ERCOT/MISO/CAISO/etc.)', category: 'Financial & Regulatory', utilityTypes: ['electric','generation_only'], matchTerms: ['iso','rto','lmp','market','ancillary'] },
  { id: 'ds_gas_market',     name: 'Gas Market & NYMEX Pricing',          description: 'Day-ahead/monthly indices, basis differentials, hedges',                 category: 'Financial & Regulatory', utilityTypes: ['gas'], matchTerms: ['nymex','gas price','basis','hedge'] },

  // ─── External ──────────────────────────────────────────────────────────
  { id: 'ds_weather',        name: 'Weather Data',                         description: 'NOAA / DTN / IBM / Tomorrow.io — observed + forecast',                   category: 'External', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['weather','noaa','forecast','temperature'] },
  { id: 'ds_demographics',   name: 'Demographics / Census',                description: 'ACS, parcel, household income, dwelling type',                          category: 'External', utilityTypes: ['electric','gas'], matchTerms: ['demographics','census','acs','household'] },
  { id: 'ds_emissions',      name: 'Carbon / GHG Emissions',              description: 'EPA, third-party emissions, ESG reporting baselines',                    category: 'External', utilityTypes: ['electric','gas','generation_only'], matchTerms: ['carbon','ghg','emissions','esg'] },
  { id: 'ds_social',         name: 'Social Media / Sentiment',             description: 'Twitter/X, news, customer-facing sentiment feeds',                       category: 'External', utilityTypes: ['electric','gas'], matchTerms: ['social','sentiment','twitter'] },
  { id: 'ds_third_party_veg',name: 'Third-Party Vegetation / Tree Data',  description: 'Overstory, AiDash species + height inventory',                            category: 'External', utilityTypes: ['electric'], matchTerms: ['vegetation','tree','overstory','aidash'] },
];

/** Normalize a string for fuzzy matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Returns the IDs of data sources that loosely match the use case's
 * dataRequirements free-text bullets. Used to bonus-score recommendations
 * when the customer has the underlying data available.
 */
export function dataSourcesMatchingUseCase(
  dataRequirements: string[],
  selectedDataSourceIds: string[]
): string[] {
  if (!selectedDataSourceIds.length) return [];
  const reqText = norm((dataRequirements || []).join(' '));
  const matched: string[] = [];
  for (const id of selectedDataSourceIds) {
    const ds = DATA_SOURCES.find((d) => d.id === id);
    if (!ds) continue;
    for (const term of ds.matchTerms) {
      if (reqText.includes(norm(term))) {
        matched.push(id);
        break;
      }
    }
  }
  return matched;
}
