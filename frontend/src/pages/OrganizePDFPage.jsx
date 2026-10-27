import MergeToolPage from './MergeToolPage'
import { zipSeparately } from '../utils/organizeClient'

// Organize = Merge UI in "organize" mode + zip export. Merge page itself has no zip code.
export default function OrganizePDFPage(props) {
  return <MergeToolPage {...props} organize exportSeparate={zipSeparately} />
}
