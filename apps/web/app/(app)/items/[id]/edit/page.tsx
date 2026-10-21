'use client';

import { useParams } from 'next/navigation';
import { ItemForm } from '@/components/item-form';

export default function EditItemPage() {
  const { id } = useParams<{ id: string }>();
  return <ItemForm mode="edit" id={id} />;
}
