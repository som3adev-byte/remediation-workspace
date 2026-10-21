import { ItemForm } from '@/components/item-form';

export const metadata = { title: 'New item · Remediation Workspace' };

export default function NewItemPage() {
  return <ItemForm mode="create" />;
}
