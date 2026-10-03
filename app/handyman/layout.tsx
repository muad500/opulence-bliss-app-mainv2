import {notFound} from 'next/navigation';import {handymanEnabled} from '@/lib/handymanMarketplace';
export const dynamic='force-dynamic';
export default function Layout({children}:{children:React.ReactNode}){if(!handymanEnabled())notFound();return children;}
