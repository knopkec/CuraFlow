import Admin from './pages/Admin';
import AuthLogin from './pages/AuthLogin';
import DataImport from './pages/DataImport';
import Help from './pages/Help';
import Home from './pages/Home';
import MyDashboard from './pages/MyDashboard';
import Schedule from './pages/Schedule';
import ServiceStaffing from './pages/ServiceStaffing';
import Staff from './pages/Staff';
import Statistics from './pages/Statistics';
import Training from './pages/Training';
import Vacation from './pages/Vacation';
import WishList from './pages/WishList';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Admin": Admin,
    "AuthLogin": AuthLogin,
    "DataImport": DataImport,
    "Help": Help,
    "Home": Home,
    "MyDashboard": MyDashboard,
    "Schedule": Schedule,
    "ServiceStaffing": ServiceStaffing,
    "Staff": Staff,
    "Statistics": Statistics,
    "Training": Training,
    "Vacation": Vacation,
    "WishList": WishList,
}

export const pagesConfig = {
    mainPage: "Schedule",
    Pages: PAGES,
    Layout: __Layout,
};