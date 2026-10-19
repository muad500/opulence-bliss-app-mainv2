// Client's comparison table; package descriptions take precedence.
export const COMPARISON_PACKAGES = [
  "Essential",
  "One-Time Essential",
  "Express",
  "Signature Deep",
  "End of Tenancy / Move-In",
  "Guest Ready / Airbnb",
] as const;
type Values = readonly [string, string, string, string, string, string];
export const CLEANING_COMPARISON: readonly { task: string; values: Values }[] =
  [
    {
      task: "Kitchen surfaces, sink, hob top",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
    {
      task: "Bathroom and toilet clean",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
    {
      task: "Vacuum and mop floors",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
    {
      task: "Dusting reachable surfaces",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
    {
      task: "Bins emptied",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
    {
      task: "Make or change beds",
      values: [
        "Yes (clean linen left out)",
        "Yes (made up)",
        "Yes",
        "Yes",
        "No",
        "Yes (full change)",
      ],
    },
    {
      task: "Interior windows",
      values: ["Add-on", "Add-on", "No", "Yes", "Yes", "Yes (reachable)"],
    },
    {
      task: "Inside oven and fridge",
      values: ["Add-on", "Add-on", "No", "Yes", "Yes", "Scheduled"],
    },
    {
      task: "Inside cupboards and drawers",
      values: ["Add-on", "Add-on", "No", "Yes", "Yes", "Add-on"],
    },
    {
      task: "Skirting, doors, switches, sockets",
      values: ["Light", "Light", "No", "Yes", "Yes", "High-touch points"],
    },
    {
      task: "Wall marks and vents",
      values: ["No", "No", "No", "Yes", "Yes", "No"],
    },
    {
      task: "Grout scrubbing, descaling",
      values: ["No", "No", "No", "Yes", "Yes", "As needed"],
    },
    {
      task: "Carpet or upholstery shampoo",
      values: ["No", "No", "No", "Add-on", "Add-on", "No"],
    },
    {
      task: "Laundry of linen and towels",
      values: ["No", "No", "No", "No", "No", "Add-on"],
    },
    {
      task: "Damage and missing-item report",
      values: ["Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
    },
  ];
