'use client';

import { useParams } from 'next/navigation';
import { ItemDetail } from '@/components/item-detail';

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  return <ItemDetail key={id} id={id} />;
}
