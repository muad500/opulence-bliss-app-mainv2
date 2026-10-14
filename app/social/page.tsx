import SocialLinks from "@/components/SocialLinks";
export const metadata = { title: "Blog & social updates | Opulence Bliss" };
export default function SocialPage() {
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "70px 20px",
        textAlign: "center",
        minHeight: "50vh",
      }}
    >
      <h1>Keep up with Opulence Bliss</h1>
      <p>
        Our latest news, home-care ideas and community updates are on our social
        pages.
      </p>
      <SocialLinks />
    </main>
  );
}
