import Link from "next/link";
import PartnerCalculator from "./PartnerCalculator";
import PartnerInterestForm from "./PartnerInterestForm";
import PartnerShareMessage from "./PartnerShareMessage";
import PartnerIllustration from "@/components/PartnerIllustrations";
import {
  PARTNER_LOYALTY_ENABLED,
  partnerProgrammeCopy,
} from "@/lib/partnerProgrammeConfig";
import styles from "./partners.module.css";
export default function PartnerPageContent() {
  return (
    <main id="top" className={styles.page}>
      <div className="in crumbs">
        <Link prefetch={false} href="/">
          {"Home"}
        </Link>
        {" / Earn with us"}
      </div>
      <section className="hero" style={{ paddingTop: "28px" }}>
        <div className="in grid">
          <div>
            <div className="eyebrow">{"Opulence Bliss Partner Programme"}</div>
            <h1>{"Turn your connections into income."}</h1>
            <p className="lead">
              {
                "Recommend trusted home cleaning to households and businesses in London and earn a reward every time someone books. Free to join. No fees, ever."
              }
            </p>
            <div className="actions">
              <a className="btn" href="#join">
                {"Become a Partner"}
              </a>
              <a className="btn ghost" href="#calculator">
                {"See what you could earn"}
              </a>
            </div>
            <ul className="trust" aria-label="Why join">
              <li>{"Free to join"}</li>
              <li>{"No fees, ever"}</li>
              <li>{"Monthly gift card rewards"}</li>
              <li>{"Serving London"}</li>
            </ul>
          </div>
          <aside
            className="ladder"
            aria-label="How a household reward is earned"
          >
            <h3>{"One household, two bookings"}</h3>
            <div className="step">
              <span className="n">{"1"}</span>
              <div>
                <b>{"Their first booking is completed and paid"}</b>
                <div className="two">
                  <div>
                    <strong>{partnerProgrammeCopy("{{rewardFirst}}")}</strong>
                    {"for you"}
                  </div>
                  <div>
                    <strong>
                      {partnerProgrammeCopy("{{discountFirst}} off")}
                    </strong>
                    {"for your friend"}
                  </div>
                </div>
              </div>
            </div>
            <div className="step">
              <span className="n">{"2"}</span>
              <div>
                <b>{"Their second booking is completed and paid"}</b>
                <div className="two">
                  <div>
                    <strong>{partnerProgrammeCopy("{{rewardSecond}}")}</strong>
                    {"for you"}
                  </div>
                  <div>
                    <strong>
                      {partnerProgrammeCopy("{{discountSecond}} off")}
                    </strong>
                    {"for your friend"}
                  </div>
                </div>
              </div>
            </div>
            <div className="sum">
              <span>{"You both get"}</span>
              <span>{partnerProgrammeCopy("{{rewardTotal}}")}</span>
            </div>
            <p className="cap">
              {
                "One-off reward for each new household. Paid to you as a gift card, monthly in arrears."
              }
            </p>
          </aside>
        </div>
      </section>
      <section className="band" id="opportunity">
        <div className="in">
          <div
            className="split2"
            style={{ alignItems: "center", marginBottom: "40px" }}
          >
            <div>
              <div className="eyebrow">{"The opportunity"}</div>
              <h2>
                {
                  "Help people find a cleaner they can rely on, and get rewarded for it."
                }
              </h2>
              <p className="lead">
                {
                  "Our Partner community brings people together with trusted professionals. Your job is simple: connect people with the services they need, and earn when they book."
                }
              </p>
            </div>
            <PartnerIllustration kind={0} />
          </div>
          <div className="cards">
            <div className="card">
              <h3>{"Home cleaning"}</h3>
              <p>
                {"Regular Standard Cleaning for busy households across London."}
              </p>
            </div>
            <div className="card">
              <h3>{"Deep cleaning"}</h3>
              <p>
                {"A thorough one-off or seasonal clean for homes and rentals."}
              </p>
            </div>
            <div className="card">
              <h3>{"Property maintenance"}</h3>
              <p>
                {
                  "Repairs and upkeep by trained handymen. No Partner reward on these bookings for now."
                }
              </p>
            </div>
            <div className="card">
              <h3>{"Business cleaning"}</h3>
              <p>
                {partnerProgrammeCopy(
                  "Offices, shops and short lets that need regular cleaning on a {{termMonths}}-month agreement.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section id="who">
        <div className="in split2">
          <div>
            <div className="eyebrow">{"Who can become a Partner"}</div>
            <h2>{"Whoever you are, there is a place for you."}</h2>
            <p className="lead">
              {
                "You do not need experience. You need people who trust your recommendation. You must be 18 or over, live in the UK and have an email address that you control."
              }
            </p>
          </div>
          <ul className="checks" style={{ marginTop: "6px" }}>
            <li>
              <b>{"Digital marketers and content creators."}</b>
              {" Turn your audience and reach into rewards."}
            </li>
            <li>
              <b>{"Stay-at-home mums and dads."}</b>
              {
                " Earn around your day by sharing something useful with people you already know."
              }
            </li>
            <li>
              <b>{"Freelancers and the self-employed."}</b>
              {" Add another income stream that fits around your clients."}
            </li>
            <li>
              <b>{"Cleaners"}</b>
              {" who are asked for recommendations every week."}
            </li>
            <li>
              <b>{"Anyone looking for another way to earn."}</b>
              {" Just your network and a willingness to spread the word."}
            </li>
          </ul>
        </div>
      </section>
      <section className="band" id="earn">
        <div className="in">
          <div className="head">
            <div className="eyebrow">{"What you can earn"}</div>
            <h2>{"Simple rewards. No fees. No hidden catches."}</h2>
            <p className="lead">
              {
                "Two ways to earn, one rule: you are rewarded when the people you introduce actually book. Never for recruiting other Partners."
              }
            </p>
          </div>
          <div className="cards">
            <div className="card">
              <div className="big">{"£0"}</div>
              <h3>{"To join"}</h3>
              <p>
                {
                  "No joining fee and no monthly fee. You never have to buy anything."
                }
              </p>
            </div>
            <div className="card">
              <div className="big">
                {partnerProgrammeCopy("{{rewardTotal}}")}
              </div>
              <h3>{"For every new household"}</h3>
              <p>
                {partnerProgrammeCopy(
                  "Paid as {{rewardFirst}} after their first booking and {{rewardSecond}} after their second. Your friend gets {{discountTotal}} off too.",
                )}
              </p>
            </div>
            <div className="card">
              <div className="big">
                {partnerProgrammeCopy(
                  "{{initialPercent}} to {{establishedPercent}}",
                )}
              </div>
              <h3>{"For every new business"}</h3>
              <p>
                {partnerProgrammeCopy(
                  "Of the business's first month's fee: {{initialPercent}} for your first {{initialCountWord}}, then {{establishedPercent}} from the {{establishedStartWord}}.",
                )}
              </p>
            </div>
          </div>
          <div className="tw" style={{ marginTop: "28px" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col" aria-label="Reward comparison" />
                  <th>{"Households"}</th>
                  <th>{"Businesses"}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{"Your reward"}</td>
                  <td>
                    {partnerProgrammeCopy(
                      "{{rewardTotal}} per new household, in two parts of {{rewardFirst}}",
                    )}
                  </td>
                  <td>
                    {partnerProgrammeCopy(
                      "{{initialPercent}} of the first month's fee for your first {{initialCountWord}}, {{establishedPercent}} from the {{establishedStartWord}}",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{"What the new customer gets"}</td>
                  <td>
                    {partnerProgrammeCopy(
                      "{{discountTotal}} off, as {{discountFirst}} off their first and {{discountSecond}} off their second booking",
                    )}
                  </td>
                  <td>
                    {partnerProgrammeCopy(
                      "Our cleaning service on a {{termMonths}}-month agreement",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{"When it counts"}</td>
                  <td>{"After each booking is completed and paid"}</td>
                  <td>
                    {partnerProgrammeCopy(
                      "After the {{trialWeeks}}-week trial ends and the first month's fee is paid",
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{"How often"}</td>
                  <td>{"Once per household"}</td>
                  <td>{"Once per business, not again on renewal"}</td>
                </tr>
                <tr>
                  <td>{"How you receive it"}</td>
                  <td colSpan={2}>
                    {
                      "A digital gift card, monthly in arrears. Not paid in cash."
                    }
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="legalbit">
            <b>{"The legal bit."}</b>
            {partnerProgrammeCopy(
              " Partner rewards apply to cleaning bookings and cleaning agreements only. They are not paid on handyman or property maintenance bookings. New customers and new businesses only. The first month's fee is the amount invoiced for the first month, before VAT, and excludes tips, one-off add-ons, product charges, credits and discounts. We decide whether to accept each business. Partner rewards are given as gift cards after the customer has paid and, for businesses, after the {{trialWeeks}}-week trial period has ended. If you are already a customer and have not registered as a Partner, your {{rewardTotal}} comes as Booking Credit for your next booking. Terms apply.",
            )}
          </p>
        </div>
      </section>
      <section id="calculator">
        <div className="in">
          <div className="head">
            <div className="eyebrow">{"Earnings calculator"}</div>
            <h2>{"See how the numbers add up."}</h2>
            <p className="lead">
              {
                "Move the sliders to match who you could introduce. The figures follow our Partner Programme Terms exactly. They are illustrations, not a forecast of what you will earn."
              }
            </p>
          </div>
          <PartnerCalculator />
          <p className="legalbit">
            <b>{"Illustration only."}</b>
            {partnerProgrammeCopy(
              " These examples are not typical or average earnings, and results depend on who you share with and how many of them book. Business rewards are paid only after the business's {{trialWeeks}}-week trial has ended and its first month's fee has been paid in cleared funds. If a payment is refunded or charged back, we may withhold the reward. You are responsible for declaring any income to HMRC.",
            )}
          </p>
        </div>
      </section>
      <section className="band" id="how">
        <div className="in">
          <div className="head">
            <div className="eyebrow">{"How it works"}</div>
            <h2>{"Three steps to your first reward."}</h2>
          </div>
          <div className="cards">
            <div className="card">
              <div className="big">{"1"}</div>
              <h3>{"Register your interest"}</h3>
              <p>{"It is free and takes less than a minute."}</p>
            </div>
            <div className="card">
              <div className="big">{"2"}</div>
              <h3>{"We welcome you"}</h3>
              <p>
                {
                  "We explain how it works and give you your personal link, guidance and ready-made messages."
                }
              </p>
            </div>
            <div className="card">
              <div className="big">{"3"}</div>
              <h3>{"Share and earn"}</h3>
              <p>
                {
                  "Tell friends, family, neighbours, followers or local businesses. When they book, you are rewarded."
                }
              </p>
            </div>
          </div>
          <h3 style={{ marginTop: "56px" }}>
            {"What happens with a business referral"}
          </h3>
          <div className="flow">
            <div>
              <b>{"You introduce"}</b>
              {
                "Using your link, code or referral form, before we have spoken to them."
              }
            </div>
            <div>
              <b>{"We accept"}</b>
              {"We decide whether to take on each business."}
            </div>
            <div>
              <b>{partnerProgrammeCopy("{{termMonths}}-month agreement")}</b>
              {"The business signs a written agreement."}
            </div>
            <div>
              <b>{partnerProgrammeCopy("{{trialWeeks}}-week trial")}</b>
              {"The trial ends without either side ending the agreement."}
            </div>
            <div>
              <b>{"You are rewarded"}</b>
              {"The first month's fee is paid and your reward is counted."}
            </div>
          </div>
        </div>
      </section>
      <section id="trust">
        <div className="in split2">
          <div>
            <div className="eyebrow">{"Recommend with confidence"}</div>
            <h2>{"Put your name behind professionals you can trust."}</h2>
            <p className="lead">
              {
                "When you recommend Opulence Bliss, you are introducing people to professionals we have checked, not strangers. Referring should never feel risky."
              }
            </p>
            <div className="artwrap">
              <PartnerIllustration kind={1} />
            </div>
          </div>
          <div className="cards" style={{ gridTemplateColumns: "1fr" }}>
            <div className="card">
              <h3>{"Checked before the first booking"}</h3>
              <p>
                {
                  "Every cleaner goes through identity and right-to-work checks and must show us a basic DBS check before they take bookings."
                }
              </p>
            </div>
            <div className="card">
              <h3>{"Their own insurance"}</h3>
              <p>
                {
                  "Cleaners hold their own public liability insurance, and we ask to see proof."
                }
              </p>
            </div>
            <div className="card">
              <h3>{"We handle problems"}</h3>
              <p>
                {
                  "If a visit is not carried out with reasonable care and skill, we arrange a re-clean or refund the affected part, so your friend is looked after."
                }
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="band" id="share">
        <div className="in">
          <div className="head">
            <div className="eyebrow">{"Share it your way"}</div>
            <h2>{"There is no script and there are no set hours."}</h2>
          </div>
          <div className="cards">
            <div className="card">
              <h3>{"Friends and family"}</h3>
              <p>{"A simple conversation can go a long way."}</p>
            </div>
            <div className="card">
              <h3>{"Neighbours and local groups"}</h3>
              <p>{"Recommend us to people nearby who need help."}</p>
            </div>
            <div className="card">
              <h3>{"Social media and your channels"}</h3>
              <p>
                {"Share a link with your followers, subscribers or readers."}
              </p>
            </div>
            <div className="card">
              <h3>{"Local businesses"}</h3>
              <p>
                {
                  "Introduce us to offices, landlords, lettings agents and hosts who need regular cleaning."
                }
              </p>
            </div>
          </div>
          <div
            className="split2"
            style={{ marginTop: "36px", alignItems: "stretch" }}
          >
            <PartnerShareMessage />
            <div className="goldbox">
              <h3>{"Tell people you are rewarded"}</h3>
              <p style={{ marginTop: "10px" }}>
                {
                  'If you are rewarded for a recommendation, say so. If you post online, label it clearly, for example "ad" or "paid partnership". It keeps your recommendation honest and follows advertising rules.'
                }
              </p>
              <ul>
                <li>{"Never promise prices, services or terms for us."}</li>
                <li>
                  {
                    "Rewards come only from customers and businesses who book, never from recruiting other Partners."
                  }
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      {PARTNER_LOYALTY_ENABLED && (
        <section id="loyalty">
          <div className="in split2">
            <div>
              <div className="eyebrow">{"More than extra income"}</div>
              <h2>{"The people you recommend keep being rewarded."}</h2>
              <p className="lead">
                {
                  "Your friends do not just get a welcome offer. Loyal customers are rewarded for staying, which makes your recommendation easier to make."
                }
              </p>
            </div>
            <div>
              <div className="cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="card">
                  <div className="big" style={{ fontSize: "42px" }}>
                    {"2 hrs free"}
                  </div>
                  <p>
                    {
                      "Standard cleaning after 10 completed bookings within 12 months."
                    }
                  </p>
                </div>
                <div className="card">
                  <div className="big" style={{ fontSize: "42px" }}>
                    {"5% off"}
                  </div>
                  <p>{"Every booking from the 11th booking onwards."}</p>
                </div>
              </div>
              <p className="legalbit">
                {
                  "Only completed, paid bookings count, and the 10 bookings must be completed within 12 calendar months. The 2 free hours are for standard cleaning and must be used within 6 months. They can add extra hours at our usual rate on top. If the 10 bookings are not completed within 12 calendar months, the count restarts from the customer's next booking. The 5% applies to the booking price only, not to tips or the £5 products add-on, and cannot be combined with other offers apart from the referral discount. Terms apply."
                }
              </p>
            </div>
          </div>
        </section>
      )}
      <section className="band" id="rewards">
        <div className="in split2">
          <div>
            <div className="eyebrow">{"How you are paid"}</div>
            <h2>{"Gift cards, every month."}</h2>
            <p className="lead">
              {
                "We convert your rewards into a digital gift card of your choice and email it to you, monthly in arrears. We pay the cost of issuing it, so you receive the full value."
              }
            </p>
            <ul className="gift" aria-label="Gift card retailers">
              <li>{"Amazon"}</li>
              <li>{"Tesco"}</li>
              <li>{"Asda"}</li>
              <li>{"Marks & Spencer"}</li>
            </ul>
            <div className="artwrap">
              <PartnerIllustration kind={2} />
            </div>
          </div>
          <div className="card">
            <h3>{"Good to know"}</h3>
            <ul className="checks">
              <li>{"Rewards are not paid in cash."}</li>
              <li>
                {
                  "If your rewards in a month are too small to issue as a gift card, we add them to the next month."
                }
              </li>
              <li>
                {
                  "You are responsible for your own tax. We do not deduct tax or National Insurance."
                }
              </li>
            </ul>
            <p className="legalbit" style={{ marginTop: "18px" }}>
              {
                "Amazon, Tesco, Asda and Marks & Spencer are not connected with Opulence Bliss and do not sponsor or endorse this programme. The retailer's own gift card terms apply, including any expiry date."
              }
            </p>
          </div>
        </div>
      </section>
      <section id="faq">
        <div className="in">
          <div className="head">
            <div className="eyebrow">{"Your questions answered"}</div>
            <h2>{"Everything you need to know before you join."}</h2>
          </div>
          <div className="faq">
            <details className="q">
              <summary>{"Is it really free to join?"}</summary>
              <p>
                {
                  "Yes. There is no joining fee and no monthly fee. You do not have to buy anything."
                }
              </p>
            </details>
            <details className="q">
              <summary>{"Am I an employee of Opulence Bliss?"}</summary>
              <p>
                {
                  "No. Partners are independent. You choose when and how you share, and you are responsible for declaring any income to HMRC. Check gov.uk for the current rules."
                }
              </p>
            </details>
            <details className="q">
              <summary>{"How and when do I receive my reward?"}</summary>
              <p>
                {partnerProgrammeCopy(
                  "Rewards are given as digital gift cards from Amazon, Tesco, Asda or Marks & Spencer, monthly in arrears, once the customer has paid for the booking or the first month's fee. For businesses, the {{trialWeeks}}-week trial must also have ended. Rewards are not paid in cash.",
                )}
              </p>
            </details>
            <details className="q">
              <summary>{"What counts as a business referral?"}</summary>
              <p>
                {partnerProgrammeCopy(
                  "A business that is new to us and signs a minimum {{termMonths}}-month cleaning agreement with Opulence Bliss. We decide whether to accept each business.",
                )}
              </p>
            </details>
            <details className="q">
              <summary>{"Do I earn if I recruit other Partners?"}</summary>
              <p>
                {
                  "No. Rewards are paid only for customers and businesses who actually buy our services, never for recruiting other people."
                }
              </p>
            </details>
            <details className="q">
              <summary>{"I am already a customer. Can I take part?"}</summary>
              <p>
                {partnerProgrammeCopy(
                  "Yes. If you refer a friend, you receive your {{rewardTotal}} as credit towards your next booking. You can also register as a Partner to receive gift cards instead.",
                )}
              </p>
            </details>
            <details className="q">
              <summary>
                {"Can I refer myself or someone in my household?"}
              </summary>
              <p>
                {
                  "No. We do not pay a reward if we reasonably believe the referral is not genuine, for example where you are the customer or live in the same household."
                }
              </p>
            </details>
            <details className="q">
              <summary>
                {
                  "Do I earn when someone books a handyman or property maintenance job?"
                }
              </summary>
              <p>
                {
                  "Not at the moment. Partner rewards currently apply to cleaning only."
                }
              </p>
            </details>
            <details className="q">
              <summary>{"Are cleaners included?"}</summary>
              <p>
                {
                  "Cleaners have their own reward scheme, including rewards for referring other cleaners. "
                }
                <Link prefetch={false} href="/provider/join">
                  {"Visit the cleaner page"}
                </Link>
                {" to find out more."}
              </p>
            </details>
          </div>
        </div>
      </section>
      <section className="formwrap" id="join">
        <div className="in split2">
          <div>
            <div className="eyebrow">{"Ready to boost your income?"}</div>
            <h2>{"Join the Partner community."}</h2>
            <p className="lead">
              {
                "Turn your skills and connections into extra income. Complete the short form to register your interest. It takes less than a minute."
              }
            </p>
            <h3 style={{ marginTop: "36px", fontSize: "19px" }}>
              {"What happens next"}
            </h3>
            <ol className="next">
              <li>
                <span>{"1"}</span>
                <div>{"Register your interest using the form."}</div>
              </li>
              <li>
                <span>{"2"}</span>
                <div>
                  {"We get in touch to welcome you and explain how it works."}
                </div>
              </li>
              <li>
                <span>{"3"}</span>
                <div>
                  {
                    "You share and earn by introducing your network to Opulence Bliss."
                  }
                </div>
              </li>
            </ol>
          </div>
          <PartnerInterestForm />
        </div>
      </section>
      <div className="in partnerLegalLinks">
        <Link prefetch={false} href="/legal/privacy">
          Privacy Policy
        </Link>
        <Link prefetch={false} href="/legal/terms">
          Customer Terms and Conditions
        </Link>
        <p className="fine">
          Partners are independent and not employees or agents of Opulence
          Bliss. Rewards are subject to our Partner Programme terms and
          conditions. Results depend on you and are not guaranteed.
        </p>
      </div>
    </main>
  );
}
