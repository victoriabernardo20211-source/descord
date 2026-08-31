import { AuthenticatedUser } from '../common/current-user.decorator';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
export {};
