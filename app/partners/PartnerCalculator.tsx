"use client";
import { useState } from "react";
import {
  PARTNER_PROGRAMME,
  calculatePartnerIllustration,
  partnerGbp,
  partnerProgrammeCopy,
} from "@/lib/partnerProgrammeConfig";

export default function PartnerCalculator() {
  const [households, setHouseholds] = useState(20),
    [secondBookingPercent, setSecondBookingPercent] = useState(70),
    [businesses, setBusinesses] = useState(4),
    [businessMonthlyFee, setBusinessMonthlyFee] = useState(800);
  const result = calculatePartnerIllustration({
    households,
    secondBookingPercent,
    businesses,
    businessMonthlyFee,
  });
  return (
    <div className="calc">
      <div className="panel">
        <h3>Your introductions</h3>
        <p className="sub">Start with a preset or set your own numbers.</p>
        <div className="grp">
          <div className="row">
            <label htmlFor="partner-households">Households you refer</label>
            <span className="val">{households}</span>
          </div>
          <div className="chips" role="group" aria-label="Household presets">
            {[10, 20, 50].map((value) => (
              <button
                type="button"
                key={value}
                className="chip"
                aria-pressed={households === value}
                onClick={() => setHouseholds(value)}
              >
                {value} households
              </button>
            ))}
          </div>
          <input
            type="range"
            id="partner-households"
            min="0"
            max="100"
            value={households}
            onChange={(event) => setHouseholds(Number(event.target.value))}
          />
        </div>
        <div className="grp">
          <div className="row">
            <label htmlFor="partner-second">
              Households who book a second time
            </label>
            <span className="val">{secondBookingPercent}%</span>
          </div>
          <input
            type="range"
            id="partner-second"
            min="0"
            max="100"
            step="5"
            value={secondBookingPercent}
            onChange={(event) =>
              setSecondBookingPercent(Number(event.target.value))
            }
          />
          <p className="hint">
            {partnerProgrammeCopy(
              "You earn the second {{rewardSecond}} only when the household's second booking is completed and paid.",
            )}
          </p>
        </div>
        <div className="grp">
          <div className="row">
            <label htmlFor="partner-businesses">Businesses you refer</label>
            <span className="val">{businesses}</span>
          </div>
          <input
            type="range"
            id="partner-businesses"
            min="0"
            max="12"
            value={businesses}
            onChange={(event) => setBusinesses(Number(event.target.value))}
          />
          <p className="hint">
            {partnerProgrammeCopy(
              "Each must sign a {{termMonths}}-month agreement and get through the {{trialWeeks}}-week trial.",
            )}
          </p>
        </div>
        <div className="grp">
          <div className="row">
            <label htmlFor="partner-fee">
              Each business&apos;s first month&apos;s fee
            </label>
            <span className="val">{partnerGbp(businessMonthlyFee)}</span>
          </div>
          <input
            type="range"
            id="partner-fee"
            min="200"
            max="3000"
            step="50"
            value={businessMonthlyFee}
            onChange={(event) =>
              setBusinessMonthlyFee(Number(event.target.value))
            }
          />
          <p className="hint">
            Before VAT. Your own figure depends on the size of the business and
            the hours it books.
          </p>
        </div>
      </div>
      <div>
        <div className="result" aria-live="polite" aria-atomic="true">
          <div className="k">
            Illustration: rewards from the introductions you chose
          </div>
          <div className="total">{partnerGbp(result.total)}</div>
          <div className="lines">
            <div>
              <span>{`Households (${households}, ${result.secondBookings} with a second booking)`}</span>
              <b>{partnerGbp(result.householdReward)}</b>
            </div>
            <div>
              <span>{`Businesses (${businesses}${businesses > PARTNER_PROGRAMME.businessInitialCount ? `, ${PARTNER_PROGRAMME.businessEstablishedPercent}% from the ${PARTNER_PROGRAMME.businessInitialCount + 1}th` : ""})`}</span>
              <b>{partnerGbp(result.businessReward)}</b>
            </div>
          </div>
          <div className="friend">
            {households
              ? `Your households would save ${partnerGbp(result.householdDiscount)} between them, as ${partnerGbp(PARTNER_PROGRAMME.householdDiscountPence[0] / 100)} off their first and second bookings.`
              : partnerProgrammeCopy(
                  "Your friends get {{discountTotal}} off when they join through you.",
                )}
          </div>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <details className="brk">
            <summary>How the business reward is worked out</summary>
            <div className="tw" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Rate</th>
                    <th scope="col">Reward</th>
                  </tr>
                </thead>
                <tbody>
                  {result.businesses.length ? (
                    result.businesses.map((business) => (
                      <tr key={business.number}>
                        <th scope="row">Business {business.number}</th>
                        <td>{business.percent}%</td>
                        <td>{partnerGbp(business.reward)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>Add a business to see the rewards.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Businesses are counted in the order their first month&apos;s fee
              is paid, across all the time you are a Partner.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
