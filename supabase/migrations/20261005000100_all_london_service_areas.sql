begin;

-- All outward codes with active postcodes in the London region (E12000007),
-- including the City of London and all 32 boroughs. ONSPD February 2022:
-- https://data.london.gov.uk/download/exp5p/62b22f3f-25c5-4dd0-a9eb-06e2d8681ef1/london_postcodes-ons-postcodes-directory-feb22.csv
-- Border districts can straddle London; coverage is sold at district level.
-- Retain the three existing area IDs and every existing provider assignment.
do $coverage$
declare area record;
begin
for area in select * from (values
  ('Central London', array['EC1A','EC1M','EC1N','EC1P','EC1R','EC1V','EC1Y','EC2A','EC2M','EC2N','EC2P','EC2R','EC2V','EC2Y','EC3A','EC3M','EC3N','EC3P','EC3R','EC3V','EC4A','EC4M','EC4N','EC4P','EC4R','EC4V','EC4Y','SW1A','SW1E','SW1H','SW1P','SW1V','SW1W','SW1X','SW1Y','W1A','W1B','W1C','W1D','W1F','W1G','W1H','W1J','W1K','W1S','W1T','W1U','W1W','WC1A','WC1B','WC1E','WC1H','WC1N','WC1R','WC1V','WC1X','WC2A','WC2B','WC2E','WC2H','WC2N','WC2R','SW1','W1']),
  ('North London', array['EN1','EN2','EN3','EN4','EN5','EN6','EN7','EN8','EN9','N1','N1C','N1P','N2','N3','N4','N5','N6','N7','N8','N9','N10','N11','N12','N13','N14','N15','N16','N17','N18','N19','N20','N21','N22','N81','NW1','NW1W','NW2','NW3','NW4','NW5','NW6','NW7','NW8','NW9','NW10','NW11','NW26','WD3','WD6','WD23']),
  ('West London', array['HA0','HA1','HA2','HA3','HA4','HA5','HA6','HA7','HA8','HA9','TW1','TW2','TW3','TW4','TW5','TW6','TW7','TW8','TW9','TW10','TW11','TW12','TW13','TW14','TW15','TW19','UB1','UB2','UB3','UB4','UB5','UB6','UB7','UB8','UB9','UB10','UB11','UB18','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13','W14']),
  ('East London', array['CM13','CM14','E1','E1W','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12','E13','E14','E15','E16','E17','E18','E20','E98','IG1','IG2','IG3','IG4','IG5','IG6','IG7','IG8','IG9','IG11','RM1','RM2','RM3','RM4','RM5','RM6','RM7','RM8','RM9','RM10','RM11','RM12','RM13','RM14','RM15']),
  ('South London', array['BR1','BR2','BR3','BR4','BR5','BR6','BR7','BR8','CR0','CR2','CR3','CR4','CR5','CR6','CR7','CR8','CR9','CR44','CR90','DA1','DA5','DA6','DA7','DA8','DA14','DA15','DA16','DA17','DA18','KT1','KT2','KT3','KT4','KT5','KT6','KT7','KT8','KT9','KT17','KT18','KT19','KT22','SE1','SE1P','SE2','SE3','SE4','SE5','SE6','SE7','SE8','SE9','SE10','SE11','SE12','SE13','SE14','SE15','SE16','SE17','SE18','SE19','SE20','SE21','SE22','SE23','SE24','SE25','SE26','SE27','SE28','SM1','SM2','SM3','SM4','SM5','SM6','SM7','SW2','SW3','SW4','SW5','SW6','SW7','SW8','SW9','SW10','SW11','SW12','SW13','SW14','SW15','SW16','SW17','SW18','SW19','SW20','SW95','TN14','TN16'])
) as coverage(name, prefixes) loop
update public.service_areas as existing
set postcode_prefixes = array(select distinct prefix from unnest(coalesce(existing.postcode_prefixes, '{}'::text[]) || area.prefixes) as prefix order by prefix),
    active = true
where existing.name = area.name;
if not found then
  insert into public.service_areas(id, name, postcode_prefixes, active)
  values(gen_random_uuid(), area.name, area.prefixes, true);
end if;
end loop;
end; $coverage$;

-- Coverage questions use the live service_areas tool; retire the obsolete copy.
update public.ai_docs
set content = 'We cover London, including Central, North, South, East and West London and outer London boroughs. Check the customer postcode with the live coverage tool or booking form. Coverage does not mean a professional is already assigned; matching happens after booking.'
where title = 'Where we cover';

commit;
